from decimal import Decimal

from django.db.models import Sum
from django.db.models.functions import Abs
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Card, Category, Income, MerchantRule, NetWorthAccount, NetWorthEntry, Transaction, YearlyExpense
from .serializers import (
    CardSerializer,
    CategorySerializer,
    IncomeSerializer,
    NetWorthAccountSerializer,
    NetWorthEntrySerializer,
    TransactionSerializer,
    YearlyExpenseSerializer,
)
from .services import (
    UnparseableFileError,
    commit_import_rows,
    extract_merchant_keyword,
    get_period_range,
    import_transactions,
)

# Fixed motivational checkpoints on the way to the freedom number - not
# user-configurable, same for every household using this app.
NET_WORTH_MILESTONES = [1000, 10000, 50000, 100000, 200000]
FREEDOM_MULTIPLIER = 25


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer


class CardViewSet(viewsets.ModelViewSet):
    queryset = Card.objects.select_related("owner").all()
    serializer_class = CardSerializer


class IncomeViewSet(viewsets.ModelViewSet):
    serializer_class = IncomeSerializer

    def get_queryset(self):
        qs = Income.objects.select_related("owner").all()
        params = self.request.query_params

        owner = params.get("owner")
        if owner:
            qs = qs.filter(owner__username=owner)

        date_from = params.get("date_from")
        if date_from:
            qs = qs.filter(date__gte=date_from)

        date_to = params.get("date_to")
        if date_to:
            qs = qs.filter(date__lte=date_to)

        return qs


class NetWorthAccountViewSet(viewsets.ModelViewSet):
    serializer_class = NetWorthAccountSerializer

    def get_queryset(self):
        qs = NetWorthAccount.objects.select_related("owner").prefetch_related("entries")
        owner = self.request.query_params.get("owner")
        if owner:
            qs = qs.filter(owner__username=owner)
        return qs


class NetWorthEntryViewSet(viewsets.ModelViewSet):
    serializer_class = NetWorthEntrySerializer

    def get_queryset(self):
        qs = NetWorthEntry.objects.select_related("account", "account__owner")
        params = self.request.query_params

        account = params.get("account")
        if account:
            qs = qs.filter(account_id=account)

        owner = params.get("owner")
        if owner:
            qs = qs.filter(account__owner__username=owner)

        return qs

    def create(self, request, *args, **kwargs):
        # Re-logging the same account+date (e.g. correcting today's balance
        # after already checking it once) should update in place, not 409 -
        # unique_together would otherwise reject it as a duplicate.
        account_id = request.data.get("account")
        entry_date = request.data.get("date")
        if account_id and entry_date:
            existing = NetWorthEntry.objects.filter(account_id=account_id, date=entry_date).first()
            if existing:
                serializer = self.get_serializer(existing, data=request.data, partial=True)
                serializer.is_valid(raise_exception=True)
                serializer.save()
                return Response(serializer.data)
        return super().create(request, *args, **kwargs)


def household_yearly_expense_from(expenses):
    """expenses is a {scope: amount} dict. The household scope, if set,
    always wins outright (it's a direct answer, not a derived one);
    otherwise fall back to summing whichever per-owner scopes are set."""
    if "household" in expenses:
        return expenses["household"]
    individual = [v for k, v in expenses.items() if k in ("soroush", "shiva")]
    return sum(individual) if individual else None


class YearlyExpenseView(APIView):
    """The answer to 'what's an average yearly expense' - either one shared
    household number or per-owner numbers (household wins if both are set -
    see household_yearly_expense_from). GET returns all set scopes as
    {scope: amount}, POST sets one scope's value (any user can set any
    scope, same no-permissions pattern as the rest of this app)."""

    def get(self, request):
        values = {ye.scope: ye.amount for ye in YearlyExpense.objects.all()}
        return Response(values)

    def post(self, request):
        scope = request.data.get("scope")
        amount = request.data.get("amount")
        if scope not in YearlyExpense.Scope.values or amount in (None, ""):
            return Response({"detail": "a valid scope and amount are required"}, status=400)
        yearly_expense, _ = YearlyExpense.objects.update_or_create(scope=scope, defaults={"amount": amount})
        return Response(YearlyExpenseSerializer(yearly_expense).data)


class FreedomSummaryView(APIView):
    """Computed net worth + freedom-goal progress. Net worth on any date is
    derived on the fly from each account's latest NetWorthEntry at or before
    that date - assets add, liabilities subtract (see
    NetWorthAccount.is_liability) - rather than stored as a running total, so
    it stays correct no matter what order entries are logged in."""

    def get(self, request):
        accounts = list(NetWorthAccount.objects.select_related("owner").prefetch_related("entries"))
        yearly_expenses = {ye.scope: ye.amount for ye in YearlyExpense.objects.all()}

        household_yearly_expense = household_yearly_expense_from(yearly_expenses)
        freedom_number = household_yearly_expense * FREEDOM_MULTIPLIER if household_yearly_expense else None

        def net_worth_as_of(as_of_date):
            total = Decimal("0")
            by_owner = {}
            for account in accounts:
                # entries are prefetched ordered -date,-id (see Meta.ordering),
                # so the first one <= as_of_date is the latest known balance.
                entry = next((e for e in account.entries.all() if e.date <= as_of_date), None)
                if entry is None:
                    continue
                signed = -entry.balance if account.is_liability else entry.balance
                total += signed
                by_owner[account.owner.username] = by_owner.get(account.owner.username, Decimal("0")) + signed
            return total, by_owner

        today = timezone.localdate()
        current_net_worth, by_owner = net_worth_as_of(today)

        all_dates = sorted({entry.date for account in accounts for entry in account.entries.all()})
        history = [{"date": d.isoformat(), "net_worth": net_worth_as_of(d)[0]} for d in all_dates]

        goals = [Decimal(m) for m in NET_WORTH_MILESTONES]
        if freedom_number:
            goals.append(freedom_number)
        goals.sort()
        next_goal = next((g for g in goals if g > current_net_worth), None)

        return Response(
            {
                "current_net_worth": current_net_worth,
                "by_owner": by_owner,
                "yearly_expenses": yearly_expenses,
                "household_yearly_expense": household_yearly_expense,
                "freedom_number": freedom_number,
                "milestones": NET_WORTH_MILESTONES,
                "next_goal": next_goal,
                "amount_to_next_goal": (next_goal - current_net_worth) if next_goal else None,
                "amount_to_freedom": (freedom_number - current_net_worth) if freedom_number else None,
                "percent_to_freedom": (current_net_worth / freedom_number * 100) if freedom_number else None,
                "history": history,
            }
        )


class TransactionViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    # Transactions are created by the import pipeline / voice capture, not this API.
    # Category changes go through recategorize() so the merchant-rule table stays in sync.
    serializer_class = TransactionSerializer

    def get_queryset(self):
        qs = Transaction.objects.select_related("owner", "card", "category")
        params = self.request.query_params

        owner = params.get("owner")
        if owner:
            qs = qs.filter(owner__username=owner)

        card = params.get("card")
        if card:
            qs = qs.filter(card_id=card)

        category = params.get("category")
        if category:
            if category == "uncategorized":
                qs = qs.filter(category__isnull=True)
            else:
                qs = qs.filter(category_id=category)

        date_from = params.get("date_from")
        if date_from:
            qs = qs.filter(date__gte=date_from)

        date_to = params.get("date_to")
        if date_to:
            qs = qs.filter(date__lte=date_to)

        amount_min = params.get("amount_min")
        amount_max = params.get("amount_max")
        if amount_min or amount_max:
            # Refunds/income-like rows are stored negative (see Transaction
            # sign convention), so filtering the raw signed amount would let
            # any negative value slip through a small Max - e.g. a -$1200
            # deposit trivially satisfies amount <= 10. Compare against the
            # displayed magnitude instead.
            qs = qs.annotate(abs_amount=Abs("amount"))
            if amount_min:
                qs = qs.filter(abs_amount__gte=amount_min)
            if amount_max:
                qs = qs.filter(abs_amount__lte=amount_max)

        search = params.get("search")
        if search:
            qs = qs.filter(description__icontains=search)

        # "Cash in" / "Cash out" - same sign convention as the amount_min/max
        # fix above: stored amount > 0 is real spending (cash out), < 0 is
        # refunds/income-like rows (cash in).
        direction = params.get("direction")
        if direction == "in":
            qs = qs.filter(amount__lt=0)
        elif direction == "out":
            qs = qs.filter(amount__gt=0)

        return qs

    @action(detail=True, methods=["patch"])
    def recategorize(self, request, pk=None):
        transaction = self.get_object()
        category_id = request.data.get("category")
        category = None if category_id in (None, "") else get_object_or_404(Category, pk=category_id)

        transaction.category = category
        transaction.save(update_fields=["category"])

        if category is not None:
            keyword = extract_merchant_keyword(transaction.description)
            if keyword:
                MerchantRule.objects.update_or_create(keyword=keyword, defaults={"category": category})

        return Response(TransactionSerializer(transaction).data)


class TransactionImportView(APIView):
    """Select who + which card -> upload file -> done.

    If the card has no saved ColumnMapping and the request doesn't supply one,
    responds with detected headers + a best-guess mapping instead of importing,
    so the frontend can show a one-time confirmation form. Once a mapping is
    saved for a card, every future upload for that card applies it automatically.
    """

    parser_classes = [MultiPartParser]

    def post(self, request):
        card_id = request.data.get("card")
        if not card_id:
            return Response({"detail": "card is required"}, status=400)
        card = get_object_or_404(Card, pk=card_id)

        uploaded_file = request.FILES.get("file")
        if not uploaded_file:
            return Response({"detail": "file is required"}, status=400)

        mapping_override = None
        if request.data.get("date_column") and request.data.get("description_column"):
            alt_card_id = request.data.get("alt_card") or None
            if alt_card_id:
                alt_card = get_object_or_404(Card, pk=alt_card_id)
                if alt_card.owner_id != card.owner_id:
                    return Response({"detail": "Alternate card must belong to the same person."}, status=400)

            mapping_override = {
                "date_column": request.data.get("date_column"),
                "description_column": request.data.get("description_column"),
                "amount_column": request.data.get("amount_column") or None,
                "debit_column": request.data.get("debit_column") or None,
                "credit_column": request.data.get("credit_column") or None,
                "category_column": request.data.get("category_column") or None,
                "type_column": request.data.get("type_column") or None,
                "alt_card_id": alt_card_id,
                "flip_sign": str(request.data.get("flip_sign", "")).lower() in ("true", "1"),
            }

        force_remap = str(request.data.get("remap", "")).lower() in ("true", "1")
        try:
            result = import_transactions(card, uploaded_file, mapping_override, force_remap=force_remap)
        except UnparseableFileError as e:
            return Response({"detail": str(e)}, status=400)
        return Response(result, status=200)


class TransactionImportConfirmView(APIView):
    """Second half of the import flow: commits a reviewed/edited batch of
    pending_transactions (from TransactionImportView) to the real ledger.
    Nothing from the first step is written to the database until this runs -
    see import_transactions/commit_import_rows in services.py.
    """

    def post(self, request):
        rows = request.data.get("rows")
        if not isinstance(rows, list):
            return Response({"detail": "rows is required"}, status=400)

        required_fields = {"date", "original_description", "description", "amount", "card_id"}
        for row in rows:
            if not isinstance(row, dict) or not required_fields.issubset(row):
                return Response({"detail": "each row needs date, original_description, description, amount, card_id"}, status=400)

        try:
            result = commit_import_rows(rows)
        except (KeyError, ValueError, TypeError) as e:
            return Response({"detail": f"Couldn't commit these rows: {e}"}, status=400)
        return Response(result, status=200)


class BudgetsSummaryView(APIView):
    def get(self, request):
        period = request.query_params.get("period", "weekly")
        if period not in ("weekly", "monthly"):
            period = "weekly"
        owner = request.query_params.get("owner")

        start, end = get_period_range(period)
        budget_field = "weekly_budget" if period == "weekly" else "monthly_budget"

        categories = Category.objects.exclude(**{f"{budget_field}__isnull": True})

        results = []
        for category in categories:
            spent_qs = Transaction.objects.filter(category=category, date__gte=start, date__lte=end)
            if owner:
                spent_qs = spent_qs.filter(owner__username=owner)
            spent = spent_qs.aggregate(total=Sum("amount"))["total"] or 0
            budget = getattr(category, budget_field)
            results.append(
                {
                    "category_id": category.id,
                    "category_name": category.name,
                    "color": category.color,
                    "budget": budget,
                    "spent": spent,
                    "remaining": budget - spent,
                }
            )

        return Response({"period": period, "start": start, "end": end, "results": results})
