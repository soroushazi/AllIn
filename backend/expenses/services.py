import io
import json
import os
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

import pandas as pd
import requests
from django.contrib.auth.models import User
from django.utils import timezone

from .models import Card, Category, ColumnMapping, Income, MerchantRule, Transaction


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
    # SoFi's own export shows Amex/Discover payoffs tersely, without any of
    # the "payment"/"epayment" wording above.
    "discover",
]


def is_payment_description(description):
    description_lower = description.lower()
    return any(keyword in description_lower for keyword in PAYMENT_KEYWORDS)


# Soroush and Shiva both have UHFCU debit cards and move money between each
# other's accounts that way - it's a transfer between our own accounts, not
# spending (or income), so like credit-card payments it's excluded from the
# ledger entirely rather than imported. Matched as a case-insensitive
# substring; tune this list once we see wording from other issuers/scenarios.
TRANSFER_KEYWORDS = [
    "online banking withdrawal transfer",
    "online banking deposit transfer",
    # Soroush's SoFi debit card, seen from the UHFCU side - money moving
    # to/from it is also his own, not spending. Deliberately narrower than a
    # bare "sofi bank" substring: SoFi's *own* export also has "SoFi Bank PL"
    # for personal loan payments, which is real spending and must NOT match
    # here (it's categorized via a MerchantRule instead - see below).
    "ach withdrawal sofi bank",
    "ach deposit sofi bank",
    # UHFCU's legal name, seen from the SoFi side - same idea, reverse
    # direction.
    "university of hawaii fcu",
]


def is_transfer_description(description):
    description_lower = description.lower()
    return any(keyword in description_lower for keyword in TRANSFER_KEYWORDS)


# Recurring deposits that are actually income, not a one-off transaction -
# excluded from the ledger the same way payments/transfers are, but logged
# to Income instead of just discarded. Matched as a case-insensitive
# substring; each entry is (keyword, income source label).
INCOME_KEYWORDS = [
    ("wsb llc", "Paycheck (WSB LLC)"),
]


def match_income_description(description):
    description_lower = description.lower()
    for keyword, source in INCOME_KEYWORDS:
        if keyword in description_lower:
            return source
    return None


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


def find_category_by_label(label):
    """Same lookup as get_or_create_category_from_label, but never creates -
    used while building an import preview, so nothing touches the database
    until the user actually approves the batch."""
    label = label.strip()
    if not label:
        return None
    return Category.objects.filter(name__iexact=label).first()


def resolve_categories_via_llm(rows):
    """Given [{"description", "amount", "category_label"}, ...] for import rows
    that matched no MerchantRule and no exact bank-category-label, ask the
    self-hosted Ollama model to map each one to one of our EXISTING categories
    using every available signal (description, bank's own label if any,
    amount) - same idea as parse_voice_transcript's category_guess, but for
    import rows instead of a voice transcript.

    Batched into a single call for the whole list rather than one call per
    row: a real import can have dozens of new rows, and each CPU-only Ollama
    call measured ~20s even warm (see parse_voice_transcript) - one call per
    row would make a weekly import take minutes instead of seconds.

    Returns a list of Category-or-None, same length/order as `rows`. Never
    invents a category name that isn't already one of ours, and never raises
    - any failure (unreachable Ollama, malformed JSON, a response that isn't
    the same length as the request) just returns all-None so the caller falls
    back to its existing bank-label-suggestion/uncategorized behavior, same
    fail-closed spirit as resolve_card/parse_voice_transcript.
    """
    if not rows:
        return []

    categories = list(Category.objects.order_by("name"))
    if not categories:
        return [None] * len(rows)
    category_names = [c.name for c in categories]

    lines = []
    for i, r in enumerate(rows):
        label_part = f', bank category: "{r["category_label"]}"' if r.get("category_label") else ""
        lines.append(f'{i + 1}. description: "{r["description"]}", amount: {r["amount"]}{label_part}')

    prompt = (
        "You are matching household expense transactions to an existing list "
        f"of budget categories: {category_names}\n\n"
        "For each numbered transaction below, decide which ONE existing "
        "category (from the list above, exactly as spelled) it clearly "
        "belongs to, using its description, amount, and bank-provided "
        "category label (if given) as clues. Only pick a category if you're "
        "confident it's a real match - otherwise use null. Never invent a "
        "category name that isn't already in the list above.\n\n"
        "Respond with only a JSON array, no other text, no markdown, with "
        f"exactly {len(rows)} objects in the same order as the transactions "
        'below, each of the shape {"category": <exact existing category '
        "name, or null>}.\n\n"
        "Transactions:\n" + "\n".join(lines)
    )

    ollama_url = os.environ.get("OLLAMA_URL", "http://ollama:11434")
    model = os.environ.get("OLLAMA_MODEL", "phi3")
    try:
        # A batch of transactions makes for a longer prompt/response than the
        # single-transcript voice call, so this gets a longer timeout - still
        # one call for the whole batch, never one per row.
        response = requests.post(
            f"{ollama_url}/api/generate",
            json={"model": model, "prompt": prompt, "format": "json", "stream": False},
            timeout=180,
        )
        response.raise_for_status()
        parsed = json.loads(response.json()["response"])
    except (requests.RequestException, ValueError, KeyError):
        return [None] * len(rows)

    if isinstance(parsed, dict):
        # phi3 occasionally wraps the array in an object (e.g. {"results":
        # [...]}) despite the prompt asking for a bare array - unwrap the
        # first list value found rather than failing closed on a technicality.
        parsed = next((v for v in parsed.values() if isinstance(v, list)), None)

    if not isinstance(parsed, list) or len(parsed) != len(rows):
        return [None] * len(rows)

    categories_by_name = {c.name.lower(): c for c in categories}
    results = []
    for entry in parsed:
        name = entry.get("category") if isinstance(entry, dict) else None
        results.append(categories_by_name.get(name.lower()) if name else None)
    return results


# --- Voice capture ----------------------------------------------------------

_whisper_model = None


def _get_whisper_model():
    # Loaded lazily and cached at module scope - loading it per-request would
    # be far too slow. WHISPER_MODEL is a size/accuracy tradeoff knob
    # ("base.en" is a good default for short expense-logging clips on CPU);
    # int8 compute keeps CPU inference fast enough for this app's scale (an
    # ARM Oracle box, no GPU).
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel

        model_size = os.environ.get("WHISPER_MODEL", "base.en")
        _whisper_model = WhisperModel(model_size, device="cpu", compute_type="int8")
    return _whisper_model


def _voice_vocabulary_hint():
    """A comma-separated list of this household's own proper nouns (user
    names, card names) fed to Whisper as an initial_prompt. Whisper doesn't
    treat this as literal text to transcribe - it conditions the decoder's
    language model toward this vocabulary, which measurably helps on short
    ambiguous words like "Soroush"/"Shiva" that aren't common English and
    would otherwise get misheard as something phonetically close. Built from
    real data (not hardcoded) so it stays correct across a username change or
    a newly-added card without a code change.
    """
    names = User.objects.order_by("id").values_list("username", flat=True)
    card_names = Card.objects.order_by("name").values_list("name", flat=True).distinct()
    words = sorted({n[:1].upper() + n[1:] for n in names} | set(card_names))
    return ", ".join(words)


def transcribe_audio(file_obj):
    """Transcribe a short voice-note recording into plain text. Accepts
    whatever format MediaRecorder produced (webm/opus, mp4/aac, ...) -
    faster-whisper decodes via PyAV, which bundles its own ffmpeg, so no
    separate ffmpeg install or format conversion step is needed."""
    model = _get_whisper_model()
    segments, _info = model.transcribe(
        file_obj, language="en", initial_prompt=_voice_vocabulary_hint()
    )
    return " ".join(segment.text.strip() for segment in segments).strip()


def resolve_card(card_guess, owner):
    """Match a free-text card guess like "Amex" or "UHFCU credit" against
    the resolved owner's real Card rows (or every card if the owner wasn't
    resolved). Word-overlap match against the card name (plus the card's own
    debit/credit type) rather than a strict substring, since real card names
    have punctuation ("UHFCU - Credit") the model won't reliably reproduce.
    Only returns a card when exactly one is the best match - same
    never-guess-when-ambiguous spirit as category resolution below, since a
    wrong card is worse than an unfilled one the user picks themselves.
    """
    if not card_guess:
        return None
    # "credit"/"debit" are handled as a separate, lower-weight signal below -
    # counting them as ordinary name words too would let a card whose *name*
    # happens to contain "Credit" (e.g. "UHFCU - Credit") tie with a card
    # that's actually a stronger name match (e.g. "Amex") just because the
    # guess also said "credit" as its type, not its name.
    type_words = {"credit", "debit"}
    guess_words = set(card_guess.lower().replace("-", " ").split())
    guess_name_words = guess_words - type_words
    candidates = Card.objects.filter(owner=owner) if owner else Card.objects.all()
    scored = []
    for card in candidates:
        name_words = set(card.name.lower().replace("-", " ").split()) - type_words
        score = len(name_words & guess_name_words) * 2
        if card.type in guess_words:
            score += 1
        if score:
            scored.append((score, card))
    if not scored:
        return None
    best_score = max(score for score, _ in scored)
    best = [card for score, card in scored if score == best_score]
    return best[0] if len(best) == 1 else None


def parse_voice_transcript(transcript):
    """Ask the self-hosted Ollama model to extract a draft transaction from a
    raw voice transcript, then resolve its free-text category/owner/card
    guesses against real data - reusing categorize_by_merchant (same
    MerchantRule table imports use), resolve_card above, and an exact
    username/category-name match, rather than duplicating matching logic.
    Never auto-creates a new Category from the LLM's guess: unlike a bank
    export's category column, an LLM's guess isn't a fixed, known
    vocabulary, and Key principle 1 (draft-before-commit for anything
    LLM-parsed) means an unmatched guess should just leave the field for the
    user to pick, not invent one - same reasoning applies to card: only
    prefill it when resolve_card is confident, never guess.

    Never raises - a broken or unreachable LLM must not block showing the
    transcript itself, so any failure just returns an unresolved draft for
    the user to fill in by hand.
    """
    draft = {
        "transcript": transcript,
        "amount": None,
        "description": None,
        "location": None,
        "notes": None,
        "category_id": None,
        "category_name": None,
        "owner": None,
        "card_id": None,
        "card_name": None,
    }
    if not transcript:
        return draft

    category_names = list(Category.objects.order_by("name").values_list("name", flat=True))
    owner_names = list(User.objects.order_by("id").values_list("username", flat=True))

    prompt = (
        "You extract structured data from a spoken household-expense note. "
        "Respond with only a JSON object, no other text, no markdown, with "
        "exactly these keys:\n"
        '"amount" (number, no currency symbol, or null)\n'
        '"description" (a short label for the specific item(s) purchased, '
        'e.g. "cookies", "gas", "haircut" - not the store name, or null)\n'
        '"location" (the store/merchant/place name, e.g. "Walmart", '
        '"Starbucks", or null)\n'
        f'"category_stated" (must be exactly one of {category_names} - only '
        'if the speaker explicitly named that category themselves, using '
        'ANY phrasing like "category is Travel", "put this under '
        'Groceries", "file this as Entertainment", "mark it as Health", '
        'or "this is Family spending" - else null - never guess this one)\n'
        f'"category_guess" (your own best-guess category for the item/place, '
        f'must be exactly one of {category_names} or null - never invent a '
        'new one - this one you SHOULD infer from context even if not '
        'explicitly said)\n'
        f'"owner" (must be exactly one of {owner_names} - only if that '
        'person was actually named in the transcript, else null - never '
        'guess from context)\n'
        '"card" (a short phrase naming the card/bank actually mentioned, '
        'e.g. "Amex", "Discover credit", "UHFCU debit" - or null if no card '
        'was mentioned - never guess)\n'
        '"notes" (any other short free-text detail beyond description/'
        'category, or null)\n\n'
        'Example 1: transcript "20 dollars for cookies from walmart, paid '
        'with Soroush Amex card" -> {"amount": 20, "description": "cookies", '
        '"location": "Walmart", "category_stated": null, "category_guess": '
        '"Groceries", "owner": "soroush", "card": "Amex", "notes": null}\n'
        'Example 2: transcript "15 dollars for a birthday gift at Target, '
        'category Gift" -> {"amount": 15, "description": "birthday gift", '
        '"location": "Target", "category_stated": "Gift", "category_guess": '
        '"Gift", "owner": null, "card": null, "notes": null}\n'
        'Example 3: transcript "30 dollars at Walmart for a phone charger, '
        'put this under Electronics" -> {"amount": 30, "description": '
        '"phone charger", "location": "Walmart", "category_stated": '
        '"Electronics", "category_guess": "Electronics", "owner": null, '
        '"card": null, "notes": null}\n\n'
        f'Transcript: "{transcript}"'
    )

    ollama_url = os.environ.get("OLLAMA_URL", "http://ollama:11434")
    model = os.environ.get("OLLAMA_MODEL", "phi3")
    try:
        # CPU-only inference for a few-billion-parameter model is genuinely
        # slow (measured ~20s for a short transcript on this dev box, even
        # with the model already loaded) - a tight timeout here would make
        # this fall back to an unresolved draft on nearly every real request,
        # not just truly-broken ones.
        response = requests.post(
            f"{ollama_url}/api/generate",
            json={"model": model, "prompt": prompt, "format": "json", "stream": False},
            timeout=90,
        )
        response.raise_for_status()
        parsed = json.loads(response.json()["response"])
    except (requests.RequestException, ValueError, KeyError):
        return draft

    location = parsed.get("location") or None
    description = parsed.get("description") or None
    draft["amount"] = parsed.get("amount")
    draft["description"] = description
    draft["location"] = location
    draft["notes"] = parsed.get("notes") or None

    # An explicitly spoken category ("category is Groceries") is the user
    # overriding/confirming a category out loud, right now - that beats a
    # possibly-stale learned MerchantRule, so it's checked first. Absent
    # that, fall back to merchant rules (location, then description - rules
    # are taught against merchant/description text either way), and only
    # as a last resort the LLM's own soft contextual guess.
    category = None
    if parsed.get("category_stated"):
        category = Category.objects.filter(name__iexact=parsed["category_stated"]).first()
    if category is None and location:
        category = categorize_by_merchant(location)
    if category is None and description:
        category = categorize_by_merchant(description)
    if category is None and parsed.get("category_guess"):
        category = Category.objects.filter(name__iexact=parsed["category_guess"]).first()
    if category is not None:
        draft["category_id"] = category.id
        draft["category_name"] = category.name

    owner = None
    if parsed.get("owner"):
        owner = User.objects.filter(username__iexact=parsed["owner"]).first()
        if owner is not None:
            draft["owner"] = owner.username

    card = resolve_card(parsed.get("card"), owner)
    if card is not None:
        draft["card_id"] = card.id
        draft["card_name"] = card.name

    return draft


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
    "category_column": ["category"],
    "type_column": ["type", "transaction type", "trans type"],
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
        if column_mapping.alt_card_id:
            # Mirror this mapping onto the alt card too, pointing back at this
            # one - so picking *either* of the owner's two cards next time
            # (not just whichever one was used to set this up) reuses the
            # same mapping and auto-splits the same way. Same file, same
            # columns, same header row either way.
            mirrored_defaults = {**mapping_override, "alt_card_id": card.id}
            ColumnMapping.objects.update_or_create(card_id=column_mapping.alt_card_id, defaults=mirrored_defaults)
            if column_mapping.alt_card.header_row != card.header_row:
                Card.objects.filter(pk=column_mapping.alt_card_id).update(header_row=card.header_row)
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
                "type_column": column_mapping.type_column,
                "alt_card": column_mapping.alt_card_id,
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
        "type_column": column_mapping.type_column,
        "flip_sign": column_mapping.flip_sign,
    }
    alt_card = column_mapping.alt_card

    parsed_rows = []
    income_rows = []
    skipped_unparseable = 0
    skipped_payments = []
    skipped_transfers = []
    type_mismatches = []
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

        if is_transfer_description(description):
            skipped_transfers.append({"date": str(date), "description": description, "amount": str(amount)})
            continue

        income_source = match_income_description(description)
        if income_source is not None:
            income_rows.append(
                {"date": date, "description": description, "amount": abs(amount), "source": income_source}
            )
            continue

        # Some issuers (e.g. UHFCU) export debit and credit transactions for
        # a person in one file, distinguished by their own "Type" column.
        # Route each row to whichever of the owner's two cards it actually
        # belongs to; anything matching neither is skipped and reported
        # rather than misfiled under the wrong card. Only applies when an
        # alt_card is actually configured - otherwise a mapped type_column
        # is just some other activity label (e.g. SoFi's "Type" is
        # Zelle/Direct_deposit/etc., not a debit/credit split), and filtering
        # rows against `card.type` with nothing to route mismatches to would
        # silently skip everything instead of importing it.
        destination_card = card
        if mapping.get("type_column") and alt_card is not None:
            type_raw = row.get(mapping["type_column"])
            if type_raw is not None and not pd.isna(type_raw):
                row_type = str(type_raw).strip().lower()
                if row_type == card.type:
                    destination_card = card
                elif alt_card is not None and row_type == alt_card.type:
                    destination_card = alt_card
                else:
                    type_mismatches.append(
                        {"date": str(date), "description": description, "amount": str(amount), "type": type_raw}
                    )
                    continue

        category_label = None
        if mapping.get("category_column"):
            category_raw = row.get(mapping["category_column"])
            if category_raw is not None and not pd.isna(category_raw):
                category_label = str(category_raw).strip() or None

        dedupe_key = Transaction.compute_dedupe_key(
            destination_card.owner_id, destination_card.id, date, description, amount
        )
        parsed_rows.append(
            {
                "date": date,
                "description": description,
                "amount": amount,
                "category_label": category_label,
                "card": destination_card,
                "dedupe_key": dedupe_key,
            }
        )

    existing_transactions = {
        t.dedupe_key: t
        for t in Transaction.objects.filter(dedupe_key__in=[r["dedupe_key"] for r in parsed_rows])
    }

    # New rows are NOT written to the ledger here - they're returned as a
    # reviewable batch (see commit_import_rows) so the user can edit the
    # description/category and approve before anything is added. Duplicates
    # of already-imported rows are a different story: they're not new
    # spending, so backfilling a category onto one that's missing it (from a
    # freshly-learned MerchantRule or a newly-mapped category column) happens
    # immediately - low-risk, since it only ever fills a gap, never creates
    # or changes an actual transaction.
    pending_transactions = []
    pending_raw = []  # (card_id, date, amount) aligned by index to pending_transactions - kept out of
    # the dict itself since it's only needed internally for the manual/voice duplicate check below.
    to_backfill = []
    duplicates = 0
    needs_llm_indices = []
    for r in parsed_rows:
        existing = existing_transactions.get(r["dedupe_key"])
        if existing:
            duplicates += 1
            if existing.category_id is None:
                resolved = categorize_by_merchant(r["description"])
                if resolved is None and r["category_label"]:
                    resolved = get_or_create_category_from_label(r["category_label"])
                if resolved is not None:
                    existing.category = resolved
                    to_backfill.append(existing)
            continue
        category = categorize_by_merchant(r["description"])
        category_label_for_row = None
        if category is None and r["category_label"]:
            category = find_category_by_label(r["category_label"])
            if category is None:
                category_label_for_row = r["category_label"]
        if category is None:
            needs_llm_indices.append(len(pending_transactions))
        pending_transactions.append(
            {
                "key": r["dedupe_key"],
                "date": str(r["date"]),
                "original_description": r["description"],
                "description": r["description"],
                "amount": str(r["amount"]),
                "card_id": r["card"].id,
                "card_name": r["card"].name,
                "category_id": category.id if category else None,
                "category_name": category.name if category else None,
                "category_label": category_label_for_row,
                "category_source": None,
                "possible_duplicate": None,
            }
        )
        pending_raw.append((r["card"].id, r["date"], r["amount"]))

    if to_backfill:
        Transaction.objects.bulk_update(to_backfill, ["category"])

    # Neither a learned MerchantRule nor an exact match against the bank's own
    # category label resolved these rows - before falling back to offering the
    # bank label as a "(new)" category suggestion (or leaving it uncategorized
    # if there's no label at all), give the LLM a shot at mapping the row into
    # one of our EXISTING categories using every signal the row has. Only
    # overrides the row when it finds a confident match; otherwise the
    # pre-existing bank-label/uncategorized fallback (already set above)
    # stands untouched. Batched into one call for the whole import, not one
    # per row - see resolve_categories_via_llm.
    if needs_llm_indices:
        llm_rows = [
            {
                "description": pending_transactions[i]["description"],
                "amount": pending_transactions[i]["amount"],
                "category_label": pending_transactions[i]["category_label"],
            }
            for i in needs_llm_indices
        ]
        llm_results = resolve_categories_via_llm(llm_rows)
        for i, category in zip(needs_llm_indices, llm_results):
            if category is not None:
                pending_transactions[i]["category_id"] = category.id
                pending_transactions[i]["category_name"] = category.name
                pending_transactions[i]["category_label"] = None
                pending_transactions[i]["category_source"] = "ai_match"

    # A voice note or a hand-typed manual entry has no exact bank description
    # to key off of (that's the whole reason the dedupe_key above won't catch
    # it), but it does carry a real card/date/amount/category once entered -
    # so a later statement import of the same real-world purchase is flagged
    # by matching on those four fields instead, and surfaced in the review
    # step for the user to remove (skip - it's already recorded) or approve
    # (keep - a genuine coincidence) rather than silently double-counting it.
    # Only checked against source=manual/voice, never against other import
    # rows - those already dedupe via the exact description-based key above.
    if pending_transactions:
        card_ids = {card_id for card_id, _, _ in pending_raw}
        dates = {row_date for _, row_date, _ in pending_raw}
        manual_voice_by_key = {}
        for t in Transaction.objects.filter(
            card_id__in=card_ids, date__in=dates, source__in=[Transaction.Source.MANUAL, Transaction.Source.VOICE]
        ):
            manual_voice_by_key.setdefault((t.card_id, t.date, t.amount, t.category_id), t)
        for i, (card_id, row_date, row_amount) in enumerate(pending_raw):
            match = manual_voice_by_key.get((card_id, row_date, row_amount, pending_transactions[i]["category_id"]))
            if match is not None:
                pending_transactions[i]["possible_duplicate"] = {
                    "id": match.id,
                    "description": match.description,
                    "date": str(match.date),
                    "amount": str(match.amount),
                    "source": match.source,
                }

    # Income has no dedupe_key like Transaction does - dedupe by
    # (owner, date, amount) so re-uploading the same file doesn't double-log
    # the same paycheck. Income isn't category-based, so - unlike
    # transactions - it still commits immediately; there's nothing here for
    # the user to review.
    existing_income_keys = set(
        Income.objects.filter(owner=card.owner, date__in=[r["date"] for r in income_rows]).values_list(
            "date", "amount"
        )
    )
    new_incomes = []
    added_income = []
    for r in income_rows:
        if (r["date"], r["amount"]) in existing_income_keys:
            continue
        new_incomes.append(Income(owner=card.owner, date=r["date"], amount=r["amount"], source=r["source"]))
        added_income.append({"date": str(r["date"]), "description": r["description"], "amount": str(r["amount"])})
    Income.objects.bulk_create(new_incomes)

    return {
        "mapping_required": False,
        "pending_transactions": pending_transactions,
        "duplicates_skipped": duplicates,
        "unparseable_rows_skipped": skipped_unparseable,
        "payments_excluded": skipped_payments,
        "transfers_excluded": skipped_transfers,
        "type_mismatches": type_mismatches,
        "income_added": added_income,
        "backfilled_categories": len(to_backfill),
    }


def commit_import_rows(rows):
    """Create real Transactions from a reviewed/edited pending_transactions
    batch (see import_transactions). Re-checks for duplicates at commit time
    (e.g. two review sessions overlapping) rather than trusting the preview
    is still current. The dedupe key is always computed from
    original_description (never the user's edited display description), so
    a cosmetic rename during review doesn't break dedup on future imports of
    the same recurring transaction.
    """
    cards_by_id = {c.id: c for c in Card.objects.filter(pk__in={int(r["card_id"]) for r in rows})}
    categories_by_id = {c.id: c for c in Category.objects.filter(pk__in={int(r["category_id"]) for r in rows if r.get("category_id")})}

    prepared = []
    for r in rows:
        card = cards_by_id[int(r["card_id"])]
        row_date = date.fromisoformat(r["date"])
        amount = Decimal(str(r["amount"]))
        dedupe_key = Transaction.compute_dedupe_key(
            card.owner_id, card.id, row_date, r["original_description"], amount
        )
        prepared.append({**r, "card": card, "date": row_date, "amount": amount, "dedupe_key": dedupe_key})

    existing_keys = set(
        Transaction.objects.filter(dedupe_key__in=[r["dedupe_key"] for r in prepared]).values_list(
            "dedupe_key", flat=True
        )
    )

    new_transactions = []
    duplicates = 0
    for r in prepared:
        if r["dedupe_key"] in existing_keys:
            duplicates += 1
            continue
        category = None
        if r.get("category_id"):
            category = categories_by_id.get(int(r["category_id"]))
        elif r.get("category_label"):
            category = get_or_create_category_from_label(r["category_label"])
        description = str(r["description"]).strip() or r["original_description"]
        new_transactions.append(
            Transaction(
                owner=r["card"].owner,
                card=r["card"],
                date=r["date"],
                description=description,
                amount=r["amount"],
                category=category,
                source=Transaction.Source.IMPORT,
                dedupe_key=r["dedupe_key"],
            )
        )

    Transaction.objects.bulk_create(new_transactions)

    return {
        "imported": len(new_transactions),
        "duplicates_skipped": duplicates,
        "uncategorized": sum(1 for t in new_transactions if t.category_id is None),
    }
