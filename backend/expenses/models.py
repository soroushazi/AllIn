import hashlib

from django.conf import settings
from django.db import models


class Category(models.Model):
    name = models.CharField(max_length=100, unique=True)
    color = models.CharField(max_length=7, help_text="Hex color, e.g. #4287f5")
    weekly_budget = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    monthly_budget = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "categories"

    def __str__(self):
        return self.name


class Card(models.Model):
    class CardType(models.TextChoices):
        DEBIT = "debit", "Debit"
        CREDIT = "credit", "Credit"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="cards")
    name = models.CharField(max_length=100, help_text="e.g. UHFCU Credit")
    type = models.CharField(max_length=10, choices=CardType.choices)

    # 1-indexed row where the real column header lives in this issuer's export.
    # Almost always 1; some issuers (e.g. Amex) prepend summary rows before it.
    # Known upfront per issuer, so it's set when the card is added rather than
    # discovered during import.
    header_row = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["owner", "name"]
        unique_together = [("owner", "name")]

    def __str__(self):
        return f"{self.owner} - {self.name}"


class Transaction(models.Model):
    class Source(models.TextChoices):
        IMPORT = "import", "Import"
        VOICE = "voice", "Voice"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="transactions")
    card = models.ForeignKey(Card, on_delete=models.CASCADE, related_name="transactions")
    date = models.DateField()
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    category = models.ForeignKey(
        Category, on_delete=models.SET_NULL, null=True, blank=True, related_name="transactions"
    )
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.IMPORT)
    dedupe_key = models.CharField(max_length=64, unique=True, editable=False)

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.date} {self.description} {self.amount}"

    @staticmethod
    def compute_dedupe_key(owner_id, card_id, date, description, amount):
        raw = f"{owner_id}|{card_id}|{date}|{description}|{amount}"
        return hashlib.sha256(raw.encode()).hexdigest()

    def save(self, *args, **kwargs):
        if not self.dedupe_key:
            self.dedupe_key = self.compute_dedupe_key(
                self.owner_id, self.card_id, self.date, self.description, self.amount
            )
        super().save(*args, **kwargs)


class ColumnMapping(models.Model):
    card = models.OneToOneField(Card, on_delete=models.CASCADE, related_name="column_mapping")
    date_column = models.CharField(max_length=100)
    description_column = models.CharField(max_length=100)

    # Either a single signed amount column...
    amount_column = models.CharField(max_length=100, null=True, blank=True)
    # ...or a split debit/credit pair. The import pipeline picks whichever is set.
    debit_column = models.CharField(max_length=100, null=True, blank=True)
    credit_column = models.CharField(max_length=100, null=True, blank=True)

    # Optional - the export's own category column (e.g. Amex/Discover both
    # call it "Category"), used to label the transaction's category as-is.
    category_column = models.CharField(max_length=100, null=True, blank=True)

    # Optional - some issuers (e.g. UHFCU) export debit and credit
    # transactions in one file for a person with both, distinguished by
    # their own "Type" column. When set, each row's parsed type is matched
    # against this mapping's own card.type or alt_card.type to decide which
    # of the owner's two cards the row actually belongs to; rows matching
    # neither are skipped and reported for review rather than misfiled.
    type_column = models.CharField(max_length=100, null=True, blank=True)
    alt_card = models.ForeignKey(Card, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    flip_sign = models.BooleanField(
        default=False, help_text="Flip the sign of parsed amounts (e.g. bank exports spend as positive)"
    )

    def __str__(self):
        return f"Mapping for {self.card}"


class MerchantRule(models.Model):
    """Merchant keyword -> category, shared across both users."""

    keyword = models.CharField(max_length=100, unique=True)
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="merchant_rules")

    class Meta:
        ordering = ["keyword"]

    def __str__(self):
        return f"{self.keyword} -> {self.category}"

    def save(self, *args, **kwargs):
        self.keyword = self.keyword.lower().strip()
        super().save(*args, **kwargs)


class NetWorthAccount(models.Model):
    """One asset or liability an owner tracks toward the Financial Freedom
    goal - e.g. "SoFi Savings", "Robinhood", "Student Loan". Balances are
    logged over time via NetWorthEntry, not stored here, so net worth can be
    charted historically the same way spending can."""

    class AccountCategory(models.TextChoices):
        SAVINGS = "savings", "Savings"
        INVESTMENT = "investment", "Investment"
        LOAN = "loan", "Loan"
        ASSET = "asset", "Other asset"
        LIABILITY = "liability", "Other liability"

    LIABILITY_CATEGORIES = {AccountCategory.LOAN, AccountCategory.LIABILITY}

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="networth_accounts")
    name = models.CharField(max_length=100, help_text="e.g. SoFi Savings, Robinhood, Student Loan")
    category = models.CharField(max_length=12, choices=AccountCategory.choices)

    class Meta:
        ordering = ["owner", "category", "name"]
        unique_together = [("owner", "name")]

    def __str__(self):
        return f"{self.owner} - {self.name}"

    @property
    def is_liability(self):
        return self.category in self.LIABILITY_CATEGORIES


class NetWorthEntry(models.Model):
    """A logged balance snapshot for one account on one date - manually
    entered per occurrence (same pattern as Income), so net worth history is
    derived from these rather than stored as a running total."""

    account = models.ForeignKey(NetWorthAccount, on_delete=models.CASCADE, related_name="entries")
    date = models.DateField()
    balance = models.DecimalField(
        max_digits=12, decimal_places=2, help_text="Always positive - sign comes from the account's category"
    )

    class Meta:
        ordering = ["-date", "-id"]
        unique_together = [("account", "date")]

    def __str__(self):
        return f"{self.account} {self.date} {self.balance}"


class YearlyExpense(models.Model):
    """An answer to 'what's an average yearly expense' - a single current
    estimate per scope, not a history. Scope is either the household as a
    whole (one shared number) or one owner's own estimate - whichever the
    household prefers to answer with. The Financial Freedom number is 25x
    the household scope's amount if set, else 25x the sum of whichever
    per-owner amounts are set."""

    class Scope(models.TextChoices):
        HOUSEHOLD = "household", "Household"
        SOROUSH = "soroush", "Soroush"
        SHIVA = "shiva", "Shiva"

    scope = models.CharField(max_length=10, choices=Scope.choices, unique=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"{self.scope} {self.amount}"


class Income(models.Model):
    """A manually-logged paycheck (or other income). Amounts vary per entry -
    biweekly paychecks aren't a fixed number, so this is entered per
    occurrence rather than as a recurring weekly/monthly figure."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="incomes")
    date = models.DateField()
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    source = models.CharField(max_length=100, blank=True, default="Paycheck")

    class Meta:
        ordering = ["-date", "-id"]

    def __str__(self):
        return f"{self.owner} {self.date} {self.amount}"
