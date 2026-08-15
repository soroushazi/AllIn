import io
import re
from datetime import timedelta
from decimal import Decimal, InvalidOperation

import pandas as pd
from django.utils import timezone

from .models import Category, ColumnMapping, MerchantRule, Transaction


def extract_merchant_keyword(description):
    """Naive merchant-name guess: strip digits/punctuation, keep the leading words.
    e.g. "TRADER JOES #123 SEATTLE WA" -> "trader joes"
    """
    cleaned = re.sub(r"[^A-Za-z\s]", " ", description)
    words = cleaned.split()
    return " ".join(words[:2]).lower()


# Paying off a credit card shows up on *both* statements involved - as a
# "payment" credit on the card and as an outgoing transfer on whatever account
# paid it. It's money moving between our own accounts, not spending, so it's
# excluded from the ledger entirely rather than imported. Matched as a
# case-insensitive substring against the description; tune this list once we
# see real statement wording from each issuer.
PAYMENT_KEYWORDS = [
    "payment - thank you",
    "payment thank you",
    "payment received - thank you",
    "internet payment",
    "online payment",
    "mobile payment",
    "web payment",
    "autopay payment",
    "auto payment",
    "e-payment",
    "epayment",
    "payment to discover",
    "payment to amex",
    "payment to american express",
    "payment to uhfcu",
    "discover payment",
    "discover e-payment",
    "amex epayment",
    "american express eft",
    "credit card payment",
]


def is_payment_description(description):
    description_lower = description.lower()
    return any(keyword in description_lower for keyword in PAYMENT_KEYWORDS)


def categorize_by_merchant(description):
    """Match a transaction description against learned MerchantRules (substring match)."""
    description_lower = description.lower()
    for rule in MerchantRule.objects.select_related("category").all():
        if rule.keyword in description_lower:
            return rule.category
    return None


# Color for categories auto-created from an export's own category column - a
# deliberately neutral, unpicked-looking color so these read as "not yet
# reviewed" next to the user's own vividly-colored categories.
AUTO_CATEGORY_COLOR = "#9a9890"


def get_or_create_category_from_label(label):
    """Look up (or create) a Category matching a bank export's own category
    label as-is, e.g. Amex's "Merchandise & Supplies-Groceries". Used as the
    transaction's real category so it's never left uncategorized just because
    it doesn't match one of the user's own categories yet - the user cleans
    these up manually later (rename/merge on the Categories screen, or
    recategorize individual transactions, which also teaches a MerchantRule
    so the same merchant stops needing this fallback).
    """
    label = label.strip()
    if not label:
        return None
    existing = Category.objects.filter(name__iexact=label).first()
    if existing:
        return existing
    return Category.objects.create(name=label, color=AUTO_CATEGORY_COLOR)


def get_period_range(period):
    """Return (start_date, end_date) for the current week (Mon-Sun) or calendar month."""
    today = timezone.localdate()
    if period == "monthly":
        start = today.replace(day=1)
        if start.month == 12:
            end = start.replace(year=start.year + 1, month=1) - timedelta(days=1)
        else:
            end = start.replace(month=start.month + 1) - timedelta(days=1)
    else:
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
    return start, end


# --- Import pipeline -------------------------------------------------------

COLUMN_HINTS = {
    "date_column": ["date", "transaction date", "posting date", "post date"],
    "description_column": ["description", "memo", "payee", "merchant", "name", "transaction"],
    "amount_column": ["amount", "transaction amount"],
    "debit_column": ["debit", "withdrawal", "amount debit", "debit amount"],
    "credit_column": ["credit", "deposit", "amount credit", "credit amount"],
    "category_column": ["category", "type"],
}


def guess_column_mapping(columns):
    """Best-effort guess of which spreadsheet column is which field, by header name."""
    normalized = [(col, str(col).strip().lower()) for col in columns]
    guess = {}
    for field, hints in COLUMN_HINTS.items():
        for col, norm in normalized:
            if norm in hints:
                guess[field] = col
                break
    return guess


class UnparseableFileError(ValueError):
    """Raised when a file can't be read as any known format - surfaced to the
    user as a 400 with a clear message instead of a 500."""


def read_transactions_file(uploaded_file, header_row=0):
    """Parse an uploaded .csv/.xls/.xlsx into a DataFrame of raw (string) rows.

    header_row is 0-indexed - most exports are 0 (first row is the header);
    some issuers (e.g. Amex) prepend a few summary rows before the real header.

    The real format is sniffed from content, not trusted from the extension -
    some issuers (e.g. Discover) label an HTML table with a ".xls" extension.
    Spreadsheet apps open these fine (they sniff content too), but a real
    Excel parser rejects them outright.
    """
    name = uploaded_file.name.lower()
    if name.endswith(".csv"):
        return pd.read_csv(uploaded_file, dtype=str, header=header_row)

    content = uploaded_file.read()
    head = content[:512].lstrip().lower()

    if head.startswith(b"<") and (b"<html" in head or b"<table" in head):
        try:
            tables = pd.read_html(io.BytesIO(content), header=header_row)
        except ValueError as e:
            raise UnparseableFileError(f"Couldn't find a table in this file: {e}") from e
        # A page can have more than one <table> (summary boxes, etc.) - the
        # transactions table is virtually always the largest one.
        return max(tables, key=len)

    if name.endswith(".xls") and not content.lstrip().startswith(b"PK"):
        # Real legacy Excel (.xls / BIFF) - openpyxl only reads .xlsx (PK-zip).
        try:
            return pd.read_excel(io.BytesIO(content), dtype=str, engine="xlrd", header=header_row)
        except Exception as e:
            raise UnparseableFileError(
                f"Couldn't read this as a legacy .xls file, and it isn't HTML either: {e}"
            ) from e

    try:
        return pd.read_excel(io.BytesIO(content), dtype=str, engine="openpyxl", header=header_row)
    except Exception as e:
        raise UnparseableFileError(f"Couldn't read this as an .xlsx file: {e}") from e


def parse_amount(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    value = str(value).strip().replace(",", "").replace("$", "")
    if value == "" or value.lower() in ("nan", "none"):
        return None
    negative = value.startswith("(") and value.endswith(")")
    if negative:
        value = value[1:-1]
    try:
        amount = Decimal(value)
    except InvalidOperation:
        return None
    return -amount if negative else amount


def parse_date(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    parsed = pd.to_datetime(str(value).strip(), errors="coerce")
    if pd.isna(parsed):
        return None
    return parsed.date()


def extract_row_amount(row, mapping):
    if mapping.get("amount_column"):
        amount = parse_amount(row.get(mapping["amount_column"]))
        if amount is None:
            return None
    else:
        debit = parse_amount(row.get(mapping.get("debit_column"))) or Decimal("0")
        credit = parse_amount(row.get(mapping.get("credit_column"))) or Decimal("0")
        amount = debit - credit
    if mapping.get("flip_sign"):
        amount = -amount
    return amount


def import_transactions(card, uploaded_file, mapping_override=None, force_remap=False):
    """Parse an uploaded statement for `card` and commit new, deduped, auto-categorized
    Transactions. Returns a dict summary, or {"mapping_required": True, ...} if the card
    has no saved ColumnMapping and none was supplied to establish one, or force_remap
    was requested (e.g. to add a column - like category_column - the saved mapping
    predates).

    card.header_row is set once when the card is added (known upfront per
    issuer, e.g. Amex/Discover prepend summary rows) rather than asked here.
    """
    column_mapping = ColumnMapping.objects.filter(card=card).first()

    df = read_transactions_file(uploaded_file, header_row=card.header_row - 1)

    if mapping_override:
        column_mapping, _ = ColumnMapping.objects.update_or_create(card=card, defaults=mapping_override)
    elif column_mapping is None or force_remap:
        suggested_mapping = guess_column_mapping(df.columns)
        if column_mapping is not None:
            # Remapping an existing card - prefill with what's already saved
            # rather than re-guessing, so the user only has to touch what's new.
            suggested_mapping = {
                "date_column": column_mapping.date_column,
                "description_column": column_mapping.description_column,
                "amount_column": column_mapping.amount_column,
                "debit_column": column_mapping.debit_column,
                "credit_column": column_mapping.credit_column,
                "category_column": column_mapping.category_column,
                "flip_sign": column_mapping.flip_sign,
            }
        return {
            "mapping_required": True,
            "detected_columns": [str(c) for c in df.columns],
            "suggested_mapping": suggested_mapping,
        }

    mapping = {
        "date_column": column_mapping.date_column,
        "description_column": column_mapping.description_column,
        "amount_column": column_mapping.amount_column,
        "debit_column": column_mapping.debit_column,
        "credit_column": column_mapping.credit_column,
        "category_column": column_mapping.category_column,
        "flip_sign": column_mapping.flip_sign,
    }

    parsed_rows = []
    skipped_unparseable = 0
    skipped_payments = []
    for _, row in df.iterrows():
        date = parse_date(row.get(mapping["date_column"]))
        description_raw = row.get(mapping["description_column"])
        amount = extract_row_amount(row, mapping)

        if date is None or amount is None or pd.isna(description_raw):
            skipped_unparseable += 1
            continue

        description = str(description_raw).strip()
        if not description:
            skipped_unparseable += 1
            continue

        if is_payment_description(description):
            skipped_payments.append({"date": str(date), "description": description, "amount": str(amount)})
            continue

        category_label = None
        if mapping.get("category_column"):
            category_raw = row.get(mapping["category_column"])
            if category_raw is not None and not pd.isna(category_raw):
                category_label = str(category_raw).strip() or None

        dedupe_key = Transaction.compute_dedupe_key(card.owner_id, card.id, date, description, amount)
        parsed_rows.append(
            {
                "date": date,
                "description": description,
                "amount": amount,
                "category_label": category_label,
                "dedupe_key": dedupe_key,
            }
        )

    existing_transactions = {
        t.dedupe_key: t
        for t in Transaction.objects.filter(dedupe_key__in=[r["dedupe_key"] for r in parsed_rows])
    }

    new_transactions = []
    to_backfill = []
    duplicates = 0
    for r in parsed_rows:
        existing = existing_transactions.get(r["dedupe_key"])
        if existing:
            duplicates += 1
            # A category column mapped (or a merchant rule learned) after this
            # row was already imported - fill in what was missing without
            # touching anything already categorized.
            if existing.category_id is None:
                resolved = categorize_by_merchant(r["description"])
                if resolved is None and r["category_label"]:
                    resolved = get_or_create_category_from_label(r["category_label"])
                if resolved is not None:
                    existing.category = resolved
                    to_backfill.append(existing)
            continue
        category = categorize_by_merchant(r["description"])
        if category is None and r["category_label"]:
            category = get_or_create_category_from_label(r["category_label"])
        new_transactions.append(
            Transaction(
                owner=card.owner,
                card=card,
                date=r["date"],
                description=r["description"],
                amount=r["amount"],
                category=category,
                source=Transaction.Source.IMPORT,
                dedupe_key=r["dedupe_key"],
            )
        )

    Transaction.objects.bulk_create(new_transactions)
    if to_backfill:
        Transaction.objects.bulk_update(to_backfill, ["category"])

    return {
        "mapping_required": False,
        "imported": len(new_transactions),
        "duplicates_skipped": duplicates,
        "unparseable_rows_skipped": skipped_unparseable,
        "payments_excluded": skipped_payments,
        "backfilled_categories": len(to_backfill),
        "uncategorized": sum(1 for t in new_transactions if t.category_id is None),
    }
