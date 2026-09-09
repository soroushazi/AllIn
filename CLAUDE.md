# Household Expense Tracker

## What this is

A private, two-user expense tracking app for Soroush and Shiva. Both of us upload
weekly Excel/CSV exports from our bank/credit cards, and the app parses, dedupes,
categorizes, and shows shared insights: who spent what, on what, and whether we're
under or over budget.

This is a **personal household tool**, not a product. Every decision should favor
simplicity over flexibility, generality, or scale. If a choice would matter for
1,000 users but doesn't matter for 2, make the simple choice.

## Goal

Replace a validated in-browser prototype (React, local-only) with a real client-server
app so that:
- Both of us see the **same shared transaction ledger** in real time, from our phones
- Data lives on a server we control, not per-device local storage
- We can later add server-side features (self-hosted LLM, voice input) that a
  local-only app can't support

## People, cards, and accounts

Only two users will ever exist in this app: **Soroush** and **Shiva**. Don't build
multi-tenant, invite, or signup systems — just two accounts, created once.

- **Soroush** — Debit: UHFCU, SoFi. Credit: UHFCU, Discover, Amex
- **Shiva** — Debit: UHFCU. Credit: Discover, Amex

All transactions are visible to both users — there is no private/shared distinction
per transaction. Filtering by person is a *view*, not a *permission*.

## Stack (decided — do not deviate without discussion)

- **Backend:** Django + Django REST Framework + PostgreSQL
- **Frontend:** React (Vite), installed as a PWA (not React Native, not a Swift app)
- **Auth:** Django's built-in session-cookie auth. No JWT, no OAuth, no third-party
  auth provider. Two users, created via Django admin or a management command.
- **File parsing:** `openpyxl` / `pandas`, done server-side after upload
- **Charts:** Recharts on the frontend
- **Voice/LLM (phase 2+):** `MediaRecorder` (browser) → self-hosted Whisper /
  `faster-whisper` (transcription) → Ollama running a small open-source model
  (Phi-3 Mini first choice, Llama 3.1 8B as fallback) for structured extraction

Why these choices, so they don't get re-litigated:
- PWA over native: installable on iPhone home screen, no App Store friction,
  `MediaRecorder` works fine in iOS PWAs (iOS 14.3+), and it's the same React skills
  either way.
- Session auth over JWT: same-domain app, two users, no need for token refresh
  complexity or mobile-specific token storage.
- Postgres over SQLite from day one: two people will write concurrently; the swap
  later is more painful than just starting correctly.
- Ollama over a hosted LLM API: cost (free after hardware) and privacy (household
  financial data never leaves our infrastructure).

## Data model (starting point — refine as needed)

- **Category** — name, color, weekly_budget (nullable), monthly_budget (nullable).
  Categories are fully custom, defined by us. No preset seed list - except that
  import can auto-create one from an export's own category column when there's
  no match (see Transaction below); those get a fixed neutral placeholder color
  (`#9a9890`, `AUTO_CATEGORY_COLOR` in `services.py`) to read as "not yet
  reviewed," and are meant to be renamed/merged/deleted manually on the
  Categories screen.
- **Card** — owner (Soroush/Shiva), name (e.g. "UHFCU Credit"), type (debit/credit),
  header_row (1-indexed row where the export's real column header lives, set when
  the card is added since it's known per-issuer upfront - default 1; Amex is 7,
  Discover is 13)
- **Transaction** — owner, card (FK), date, description, amount, category (FK,
  nullable = uncategorized - but import only leaves it null when there's truly
  no signal; see below), notes (free-text detail beyond the category, e.g.
  who/where/why), location (free-text, e.g. "Walmart" vs "Trader Joe's" -
  separate from category so spend-by-merchant is answerable), tags (M2M to
  Tag), source ("import", "voice", or "manual" - see below), dedupe_key.
  notes/location/tags are purely manual, never touched by import/voice, and
  are edited via an explicit Edit dialog (Transactions screen) rather than
  on-the-fly, to avoid accidental edits. Import resolves `category` as: an
  existing MerchantRule match first, else - if the card's mapping has a
  category_column - the export's own category label as a suggestion. New
  (non-duplicate) rows are never written straight to the ledger with that
  suggestion, though: they're held as an in-memory, unpersisted preview
  (`pending_transactions`) for the user to review/edit (description and
  category, per-row) and explicitly approve via `POST /api/import/confirm/`
  before anything is created - see the 2026-08-16 "Import: review-before-commit"
  status note below. Only at that approval step does an accepted bank label
  actually get-or-created as a real Category (case-insensitive exact match).
  Manually recategorizing a transaction later (Transactions screen) both
  fixes it and teaches a MerchantRule, so future imports of the same
  merchant pre-fill the real category during review and skip needing a
  bank-label suggestion entirely. A single transaction can also be added by
  hand (`source="manual"` - Import screen's "Add transaction" tab, or the
  same form as a pop-up on the Transactions screen) - see the 2026-08-17
  "Manual add + duplicate finder" status note for how this differs from a
  bulk import (no exact description to dedupe against, so it warns on a
  same-card/date/amount match instead of silently skipping or allowing).
  Import review also runs the same idea in reverse: each new pending row is
  checked against existing `source="manual"`/`"voice"` transactions on
  card+date+amount+category (not description, since a hand-typed/spoken
  entry won't share the bank's exact wording), and flagged rows carry a
  `possible_duplicate` the user removes or approves per-row during review -
  see the 2026-09-09 "Import: flag duplicates of manual/voice entries"
  status note.
- **Tag** — name (unique, case-insensitive). Free-form labels a user attaches
  to transactions (e.g. a trip name) so spending under that label can be
  found again later - shared across both users, created implicitly the
  first time a tag name is used (`GET /api/tags/` just lists existing ones
  for autocomplete/filtering).
- **ColumnMapping** — per (owner, card): which spreadsheet columns map to date/
  description/amount, debit/credit split, or the export's own category column
  (optional), plus a sign-flip flag. Learned once per card (via the Import
  screen's first-upload flow), reused on every future upload for that card.
  Also optionally: `type_column` + `alt_card` (FK, same owner only) - for
  issuers that export one person's debit *and* credit transactions in a
  single file distinguished by their own type column (e.g. UHFCU). Each
  row's parsed type is matched against this mapping's own `card.type` or
  `alt_card.type` to decide which of the owner's two cards it actually
  belongs to; unmatched rows are skipped and returned for review rather
  than misfiled.
- **MerchantRule** — merchant keyword → category. Learned automatically whenever
  a user categorizes a transaction; applied to future imports/voice entries so
  recurring merchants stop needing manual tagging.
- **Income** — owner, date, amount, source (free text, default "Paycheck").
  Manually logged per occurrence (Import screen → "Log income" toggle) rather
  than as a recurring weekly/monthly figure, since real paychecks vary payout
  to payout even on a fixed biweekly schedule. Full CRUD (`IncomeViewSet`,
  `/api/income/`) filtered by owner/date_from/date_to, same pattern as
  Transaction. Feeds the Overview "Income vs spending" card.
- **VoiceDraft** — sketched here originally as a model, but built (2026-08-19)
  as a stateless draft instead, same precedent as import's
  `pending_transactions` (see the 2026-08-16 "Import: review-before-commit"
  note): a voice recording is transcribed (self-hosted Whisper) and parsed
  (self-hosted Ollama/Phi-3) into a draft that's never written to the
  database - the existing `AddTransactionForm` (Transactions/Import's manual
  add) is reused as the one-tap confirm UI, prefilled from the parse result,
  with `source="voice"` once submitted through the same `POST
  /api/transactions/` manual-add path. See the 2026-08-19 status note.
- **NetWorthAccount** — owner, name, category (`savings`/`investment`/`loan`/
  `asset`/`liability` — the last two are free-form catch-alls for anything
  beyond the three named buckets). Powers the Financial Freedom tab. Doesn't
  store a balance itself — see NetWorthEntry.
- **NetWorthEntry** — account (FK), date, balance (always positive; sign
  comes from the account's category via `is_liability`). A manually-logged
  snapshot per occurrence, same pattern as Income, so net worth can be
  charted historically — current net worth for any date is derived from
  each account's latest entry at or before that date, not stored as a
  running total.
- **YearlyExpense** — scope (`household`/`soroush`/`shiva`, one row per
  scope), amount. The answer to "what's an average yearly expense" —
  either one shared household number or per-person numbers, toggleable in
  the UI (Net worth accounts settings) - a single current value per scope,
  not a history. The Financial Freedom number is 25x the `household` scope's
  amount if set, else 25x the sum of whichever per-person scopes are set.

## Key principles

1. **Draft-before-commit for anything LLM/voice-parsed, or bank-label-categorized.**
   Parsed transactions from voice input, and newly-imported transactions whose
   category comes from a bank's own export label, are always shown as an
   editable draft requiring explicit confirmation before they hit the real
   ledger. Never silently auto-commit parsed data or bank-supplied categories.
2. **Dedup on import.** Re-uploading a file with overlapping dates must not create
   duplicate transactions. Use a dedupe key of (owner, card, date, description,
   amount). For a manually-typed or voice-parsed entry there's no exact bank
   description to key off of, so instead of silently skipping (import's
   behavior) or silently allowing a likely double-entry, warn once on a
   same-card/date/amount match and let the user confirm "add anyway." The
   reverse direction matters too: when a manual/voice entry gets recorded
   *before* its statement arrives, the eventual import row will have a
   different (bank-written) description, so the exact key above won't catch
   it - the import review step separately flags a match on
   card/date/amount/category against existing manual/voice transactions, and
   the user removes or approves it per row (see the 2026-09-09 "Import: flag
   duplicates of manual/voice entries" status note).
3. **Learn from corrections.** Every manual category correction should update the
   merchant-rule table so the same merchant auto-categorizes next time, for both
   users.
4. **Keep the upload flow to nearly zero friction.** Select who + which card →
   upload file → done. Column mapping should only be asked once per card, ever
   (until the bank changes their export format and we explicitly re-map).
5. **No over-engineering.** No multi-tenancy, no roles/permissions system, no
   feature flags, no premature abstraction for hypothetical future users. If in
   doubt, build the smaller version.

## Build order (do not skip ahead)

### Phase 1 — MVP (current focus)
- [x] Django project scaffold + DRF + Postgres, deployable locally via
      `docker-compose` (db + backend, frontend served separately in dev)
- [x] Models: Category, Card, Transaction, ColumnMapping, MerchantRule
- [x] Two users created (Soroush, Shiva) via a management command, session-cookie
      auth wired up (`/api/auth/csrf|login|logout|me/`)
- [x] API endpoints: upload/import, list/filter transactions, CRUD categories,
      recategorize transaction, budgets summary
- [x] Server-side import pipeline: parse Excel/CSV, auto-detect columns, apply
      saved mapping or prompt for one, dedupe, auto-categorize via MerchantRule
- [x] React (Vite) frontend, PWA-installable (manifest + service worker):
      Overview (combined/per-person, weekly/monthly, category breakdown, trend
      chart), Import, Transactions (search/filter/recategorize/delete), Budgets,
      Categories (create/edit/delete, incl. budgets and color), Cards
      (create/edit/delete) — code written and now verified end-to-end in a real
      browser (see status note below)
- [ ] Both of us using it day-to-day from our iPhones, replacing the old artifact

#### Status as of 2026-08-15 — where to pick up next session

Backend (`backend/`) is fully built and was verified end-to-end at each step
(round-tripped through the ORM / curl / Docker, not just written and assumed to
work): models, dedupe, session auth, all API endpoints, and the CSV/XLS/XLSX
import pipeline including mapping auto-detection, dedup, merchant-rule
auto-categorization, and credit-card-payment exclusion (see below).

Frontend (`frontend/`) is: Vite + React (JS, not TS) + `react-router-dom` +
`recharts` + `vite-plugin-pwa`. Nine screens (Overview, Import, Voice,
Transactions, Financial Freedom, Budgets, Categories, Cards, Account), a
Login screen, session-based `AuthContext`, and an `api.js` fetch client.
Navigation is split by how often each screen gets used (see the
2026-08-15 nav-restructure status note near the end of this file): the
5-tab bottom nav is Overview / Import / Voice / Transactions / Financial
Freedom; Budgets/Categories/Cards/Account are "set once, revisit rarely" and
live behind the account menu (hamburger icon, top right) instead. `npm run
build` and `npm run lint` both pass clean.

**Real data now exists** (created this session, via ORM/API — not invented
passwords): the real `soroush`/`shiva` Django accounts (created by the user
directly, real passwords), all 8 real cards (Soroush: UHFCU/SoFi debit,
UHFCU/Discover/Amex credit; Shiva: UHFCU debit, Discover/Amex credit) per the
People/cards/accounts section above, and all 15 real categories (Rent, House,
Mater, Loan, Family, Groceries, Eating Out, Cloths, Health, Entertainment, Self
Improvement, Gift, Travel, Electronics, Transportation) with distinct colors,
no budgets set yet (weekly/monthly budgets are editable per-category on the
Categories screen whenever the user wants to set them).

**This session's additions:**
- A **Categories screen** (`pages/Categories.jsx`) — the backend
  `CategoryViewSet` already had full CRUD, but no frontend page exposed
  create/edit/delete. Create form (name, color picker, optional weekly/monthly
  budget) plus an editable list with Save/Delete per row.
- A **Cards screen** (`pages/Cards.jsx`) — `CardViewSet` was previously
  `ReadOnlyModelViewSet`; upgraded to full `ModelViewSet` (and
  `CardSerializer.owner` from a read-only nested field to a writable
  `SlugRelatedField` on username) so cards can be created/edited/deleted from
  the UI, not just seeded via the ORM. Delete has an explicit warning that it
  cascades to that card's transactions (unlike Category delete, which safely
  uncategorizes instead of deleting).
- Generically improved `api.js` error handling to surface DRF validation
  messages (e.g. "category with this name already exists") instead of a
  generic "Bad Request".
- **`.xls` import support** — Discover exports legacy `.xls` (BIFF), which
  `openpyxl` can't read (`.xlsx`-only). `read_transactions_file()` now branches
  on extension: `xlrd` for `.xls`, `openpyxl` for `.xlsx`. Added `xlrd` to
  `requirements.txt`; the file input's `accept` now includes `.xls`.
- **Credit-card-payment exclusion** — paying off a card shows up on *both*
  statements involved (a "payment" credit on the card, an outgoing transfer on
  whatever account paid it); neither is real spending, so both would
  double-count if imported. `services.py` now has a `PAYMENT_KEYWORDS`
  substring list (`"payment - thank you"`, `"autopay payment"`,
  `"payment to discover"`, etc. — see the list for the full set) checked via
  `is_payment_description()`; matching rows are excluded from the ledger
  entirely (not imported, not stored) rather than imported and flagged, since
  the user explicitly asked for them not to be included. The import result now
  returns `payments_excluded: [{date, description, amount}, ...]`, and
  `Import.jsx` shows the count plus an expandable review list so every upload
  can be sanity-checked — if real spending ever gets caught by the filter, the
  fix is to tighten `PAYMENT_KEYWORDS` once we see the exact wording.
- **Fixed a real connectivity bug**: the frontend called the backend directly
  cross-origin (`http://localhost:8000`), and this environment runs in a
  GitHub Codespace, where the frontend/backend are reached from an outside
  browser via *different* forwarded hostnames
  (`<name>-5173.app.github.dev` / `<name>-8000.app.github.dev`). Two problems
  stacked: (1) the hardcoded `localhost:8000` isn't reachable at all from an
  outside browser, and (2) even after pointing at the right forwarded host,
  those are different registrable domains, which browsers treat as genuinely
  cross-*site* — `SameSite=Lax` session/CSRF cookies don't ride along on
  cross-site fetches, so auth would silently fail per-request even though
  login itself appeared to succeed. Root-caused via headless Playwright by
  reproducing the exact empty-dropdown symptom, not guessed. **Fix:** the Vite
  dev server now proxies `/api/*` to the backend
  (`vite.config.js: server.proxy`), and `api.js` calls relative paths instead
  of an absolute cross-origin URL — the browser only ever talks to one origin,
  so there's no CORS and no cross-site cookie problem, locally or over the
  Codespaces forwarded URL. (Backend `settings.py` also auto-appends the
  Codespace's forwarded origins to `ALLOWED_HOSTS`/`CORS_ALLOWED_ORIGINS`/
  `CSRF_TRUSTED_ORIGINS` when `CODESPACE_NAME` is set, for the case of hitting
  the backend's own forwarded URL directly, e.g. `/admin/`.) Rebuilt the
  backend image (for `xlrd`) and restarted both the backend container and the
  Vite dev server to pick all of this up.
- **Fixed a second real bug found once the user actually tried uploading**:
  first-time import for *any* card (no saved `ColumnMapping` yet) returned
  HTTP 422 with the mapping-required payload in the body — but `api.js`'s
  `request()` treats any non-2xx as a hard error and throws before
  `Import.jsx` ever inspects `data.mapping_required`, so the mapping form
  never appeared; the user just saw a generic "Unprocessable Content" error.
  This would have blocked the first upload for every card, not just Amex.
  Fix: `TransactionImportView` now always returns 200; `mapping_required` in
  the body (which `Import.jsx` already correctly branched on) drives the flow
  instead of the status code.
- **Amex header-row support**: Amex's export has 6 summary rows before the
  real header (row 7). Added `ColumnMapping.header_row` (0-indexed, migration
  `0002_columnmapping_header_row`), threaded through
  `read_transactions_file()`/`import_transactions()` (`pandas`'s `header=`
  kwarg), and a "Header row" number input (default 1) on the first Import
  form. Saved per-card like the rest of the mapping, so it's only ever entered
  once per card - future uploads for that card apply it automatically.

**Browser verification done this session:** no Chrome extension connected, no
`chromium-cli` — used headless Playwright throughout, driven through the same
relative-path proxy setup a real browser now uses (not by calling the backend
directly, which would have masked the cross-site-cookie bug). Verified, each
against the real backend with before/after counts and screenshots:
Categories create → edit/save → delete; Cards create → edit/save → delete; the
Import page's card dropdown populating (was empty before the proxy fix, full
list of 8 after); `.xls` parsing through the real `import_transactions()`
pipeline with a synthetic Discover-style file (one real purchase, one
"DISCOVER PAYMENT THANK YOU" row) — confirmed the purchase imports, the
payment is excluded and reported, and re-uploading the same file dedupes the
purchase and excludes the payment again consistently; the full two-step
mapping flow (initial 200-with-mapping-required response → confirm with
column choices + header_row=7 → import) end-to-end over real HTTP with a
synthetic Amex-style file (6 junk rows, header row 7), confirming the
mapping/header_row persist and a third mapping-free re-upload auto-reuses
them. The Login screen only
offers Soroush/Shiva via toggle buttons (no free-text username), so
verification logged in a throwaway `_verify_temp` Django user directly against
the `/api/auth/login/` API (no username allowlist there) rather than touching
real credentials; that account and all test cards/categories were deleted
immediately after each check. Real data (8 cards, 15 categories, both real
users) confirmed intact and unmodified after every round.
**Confirmed working by the user** (not just this environment): the Codespaces
forwarded-URL flow and a real Amex upload both succeeded from their actual
browser after the connectivity/422/header-row fixes above.
**Not verified:** PWA installability on an actual iPhone (needs a physical
device).

**Also this session:** added `imported_category` (Transaction) and
`category_column` (ColumnMapping) — Amex and Discover both export their own
"Category" column (Discover's header row is 13, separate from Amex's 7; each
card's header_row/column choices are independent, stored per-card as always).
Per the user's explicit instruction, the raw bank category string is stored
as-is on the transaction and does **not** get matched against our own
`Category` table - that matching (bank category + description → real
category) is explicitly deferred to a future NLP/LLM step (not the same as
the Phase 2/3 voice-capture work below, though it'll likely reuse the same
self-hosted Ollama setup once built - not yet scoped as its own phase).
`category_column` is optional and auto-suggested the same way
as the other columns; `Transactions.jsx` shows the raw value as "Bank
category: …" for still-uncategorized transactions, so it's not inert while
Phase 3 is pending. Verified end-to-end over real HTTP with a synthetic
Amex-style file (6 junk rows, `Category` column) - column auto-detected,
`imported_category` stored and returned via the API. Migration
`0003_columnmapping_category_column_and_more`.

**Also this session (in response to user feedback after their first real
uploads):**
- The Import screen's rarely-needed "Header row" field is now hidden behind a
  native `<details>`/`<summary>` "More information" disclosure (collapsed by
  default) instead of always shown - same pattern reused for the "review
  excluded payment rows" section. No new JS state, just native HTML.
- **`header_row` moved from `ColumnMapping` to `Card`** (migration
  `0004_remove_columnmapping_header_row_card_header_row`) - it's a fixed
  property of how an issuer formats their export (known upfront), not
  something to discover per-upload, so it's now set once when the card is
  added/edited on the Cards screen (also behind a "More information"
  disclosure there, default 1) rather than asked during Import. `Card` model
  gained `header_row` (1-indexed, default 1); `import_transactions()` now
  always reads `card.header_row` directly - no more `header_row` param
  anywhere in the request/view/service chain. Backfilled the 8 real cards:
  both Amex → 7, both Discover → 13, everything else stays default 1
  (confirmed via the ORM). Verified end-to-end over real HTTP with a synthetic
  6-junk-row file and a card carrying `header_row=7` - correctly parsed with
  zero header_row-related params in the request at all; also verified the
  Cards screen's create flow round-trips a custom header_row correctly via
  headless Playwright (screenshot taken, all 8 real cards confirmed unaffected
  afterward).
- **Fixed a real gap found from the user's actual first Amex import**: their
  real Amex `ColumnMapping` was created *before* `category_column` existed
  (during their earlier successful test upload), so it was permanently stuck
  at `category_column: None` - "column mapping is asked once per card, ever"
  meant there was no way to fix it, and the 13 already-imported Amex
  transactions all had `imported_category: None`. Two fixes: (1) added an
  explicit re-map path - a "Re-map columns for this card" checkbox behind
  Import's "More information" disclosure, which forces the mapping form to
  reappear even though a mapping already exists, prefilled with the *current
  saved mapping* (not re-guessed) so the user only has to add what's missing;
  backend takes a `remap` flag (`TransactionImportView`/`import_transactions`
  gained `force_remap`). (2) On every import, if a row dedupes against an
  *existing* transaction whose `imported_category` is still `None`, it's now
  backfilled from the newly-parsed row instead of silently staying empty
  forever (`to_backfill` list + one `bulk_update`, in `services.py`) - never
  overwrites anything already set, only fills the gap this exact bug caused.
  Result now includes `backfilled_categories`; `Import.jsx` shows it inline
  next to the duplicates-skipped count. **Also directly fixed the user's real
  Amex mapping** (`category_column = "Category"`, confirmed via the ORM,
  since the user had already told us the exact column name) - their next
  Amex upload needs no extra steps; re-uploading the same weekly file will
  backfill the 13 already-imported transactions automatically. Verified the
  whole mechanism end-to-end over real HTTP reproducing the exact bug
  (mapping without `category_column`, then a re-upload with it): confirmed
  default behavior is unchanged without `remap`, `remap` prefills from the
  saved mapping, and confirming it backfills exactly the affected duplicates
  (2/2 in the test) without touching new rows' normal import path.

**Superseded later the same session** - the `imported_category` free-text
field (added, then used for the backfill fix above) turned out not to be what
the user wanted: they explicitly asked for the export's own category to
become the transaction's *real* `category` (creating a new Category if we
don't have a match yet), not a separate hint field, since a bank category
column effectively always has *some* signal - better to use it than leave the
transaction uncategorized. So `imported_category` was removed again
(migration `0005_remove_transaction_imported_category`) and the import
pipeline now resolves `category` directly (see Data model above);
`get_or_create_category_from_label()` in `services.py` does the get-or-create,
`AUTO_CATEGORY_COLOR` marks these as placeholders. The duplicate-backfill
mechanism from the fix above was kept but retargeted at `category` instead of
`imported_category` - same shape, same safety property (never overwrites an
already-set category). Verified end-to-end over real HTTP: two distinct bank
category labels on one upload correctly auto-created two new categories and
assigned them (`uncategorized: 0`); manually recategorizing one transaction
to a real curated category (Groceries) correctly taught a MerchantRule; a
*subsequent* upload of the same merchant then skipped the placeholder
entirely and went straight to the real category - confirming the intended
"import labels it with the bank's category → user manually fixes once → every
future import of that merchant just works" workflow. Also worth noting: by
this point the user had cleared all real transactions themselves (0 in the
DB, cards/categories/mappings all still intact) - so there was nothing to
backfill for real data, unlike earlier in the session. The user then
re-uploaded their real Amex file on their own and it worked end-to-end: 13
real transactions imported, most auto-categorized from Amex's own labels
(confirmed live, not just in test).

**Also this session: fixed a real 500 on Discover's `.xls` upload.**
Discover's export is a `.xls`-*named* file that's actually an HTML table
(`xlrd` choked with `Expected BOF record; found b'<html xm'` - confirmed from
the actual backend traceback, not guessed). This is a known quirk of some
bank export tools; spreadsheet apps open these fine because they sniff
content, real Excel parsers don't. Fix, in `read_transactions_file()`
(`services.py`): **content is now sniffed, not trusted from the extension** -
`<html`/`<table` at the start → `pd.read_html()` (added `lxml` to
`requirements.txt` as its parser backend; picks the largest `<table>` on the
page as the transactions table, since summary boxes etc. are usually much
smaller), a real `.xls` still goes to `xlrd`, everything else to `openpyxl`.
Also added a general safety net: any parse failure now raises
`UnparseableFileError`, which `TransactionImportView` catches and returns as
a clean `400` with a readable message, instead of an unhandled exception
producing a raw 500 (confirmed via a genuinely garbage file - was a 500 with
a full traceback dump before, is now a clean 400 with a helpful `detail`).
Verified the actual fix end-to-end over real HTTP with a synthetic file
reproducing the real shape (HTML content, `.xls` extension, 12 junk rows
before the header, a `Category` column, a payment row) at the user's real
`header_row=13` for Discover: parsed correctly, purchase imported with an
auto-created category, payment row excluded, no crash. Backend image rebuilt
for the new `lxml` dependency and container recreated.

**Follow-up the same session: the user retried and hit a second 500** -
confirmed from the real backend traceback again (not guessed): `pd.read_html`
tried `lxml` first, that failed on the user's *actual* file for an unlogged
reason, pandas fell back to the `html5lib` flavor (more lenient/tolerant of
real-world malformed markup - a very plausible reason it succeeds where lxml
doesn't), which raised `ModuleNotFoundError: No module named 'html5lib'`
because only `lxml` had been installed, not the full fallback stack. Added
`html5lib` and `beautifulsoup4` (html5lib's dependency) to `requirements.txt`
so pandas' built-in multi-parser fallback actually has both parsers available
to fall back *to*. Rebuilt the image again, recreated the container. Verified
the original synthetic repro still passes end-to-end over real HTTP, and
additionally stress-tested a deliberately messier synthetic file (unclosed
`<td>`/`<tr>`, `&nbsp;` cells, Windows-1252 encoding, MS Office XML
namespaces) - it hit a *different*, legitimate failure (header row 13 not
matching that file's actual row count once malformed markup collapses some
rows) and correctly surfaced as a clean 400 instead of crashing, which is the
safety net working as designed. **Not yet confirmed** whether the real
Discover file works end-to-end now - the user should retry; if it fails again
the error will be far more diagnostic than a bare 500 (either it works, or it
returns a specific 400 reason we can act on immediately).

**Third round, same session - the user retried and got "No tables found."**
This time the user shared the actual real file (`temp/` in the repo root,
gitignored - see below), which let us stop guessing. Diagnosis, fully
confirmed by reading the whole file, not inferred: the file the user had
was **not the transaction data at all** - it was the frameset *shell* Excel
generates for "Save As → Web Page" (not "Single File Web Page"), containing
zero transaction data (`grep`-confirmed: no "Category"/"Amount"/"$" anywhere
in its 325 lines) and a literal `<frameset>` pointing at a companion file
(`<frame src="DFS-Search-20260815_files/sheet001.htm">`) that was never
actually given to our app - only Excel, opening the file locally, was able to
follow that link (which is also why Excel showed its own "format and
extension don't match" warning - it's genuinely not real `.xls`, same finding
we'd already made). The user then provided a second, correct sample
(`Discover-RecentActivity-20260815.xls`) - a real self-contained one-page
export, no frameset, no companion files.

That second file revealed the actual remaining bug: it has **two separate
`<table>` elements** (an account-info table with the user's name/address/
phone, then the transactions table), and the transactions table's own real
header is **row 1** - not row 13. Row 13 (which the user had given us
earlier, reasonably) was almost certainly counted by visually flattening both
tables plus blank lines into one continuous sheet in Excel; our parser
already correctly treats each `<table>` separately and picks the larger one
(`max(tables, key=len)`), so the page-level "row 13" never applied once that
selection happens. Fix: **corrected `header_row` on both real Discover cards
from 13 to 1** (confirmed via the ORM - no `ColumnMapping` existed yet for
either, so nothing else needed cleanup). Verified end-to-end over the real
HTTP API using the user's actual real file: 6 real purchases imported and
auto-categorized from Discover's own labels, both "INTERNET PAYMENT - THANK
YOU" rows correctly excluded, and confirmed the account-info table's PII
(name/address/phone) never gets parsed/stored - only the larger transactions
table is ever read. All test artifacts cleaned up afterward.

**Safety note from this round:** the user's real sample files (one containing
their actual name/address/phone) were placed in `temp/` at the repo root to
let us inspect them directly - that directory wasn't in `.gitignore`. Nothing
had actually been committed yet, but it wasn't safe left that way. Added `temp/` to
`.gitignore` immediately. The files themselves are still sitting there as of
this writing - worth deleting once the user confirms they're done needing
them for reference.

**Next steps, in order:**
1. ~~Open the app in a browser and click through Login → all tabs~~ — done.
2. ~~Create the real Soroush/Shiva accounts~~ — done (user created them
   directly).
3. ~~Set up real categories and cards~~ — done (cards + categories above), and
   both now have full CRUD screens for ongoing edits.
4. ~~Try a real weekly export upload through the Import screen end-to-end~~ —
   done; Amex **and** Discover both confirmed working live by the user
   (Discover explicitly: "import works just fine... works perfectly").
   SoFi/UHFCU still untried - each needs its column mapping established on
   first upload; watch for the same "is this issuer's .xls actually HTML,
   and is the real header row 1 or something else" questions if either one
   also 500s or produces obviously-wrong columns.
5. Test "Add to Home Screen" on an iPhone to confirm PWA installability.
6. Once the above is solid, this becomes daily-use and the last Phase 1 checkbox
   can be marked done.

#### Nav restructure — 2026-08-15, later the same day

With import working, the user shifted focus to navigation: Budgets/Categories/
Cards were cluttering the bottom nav for screens that are "set once, revisit
rarely," not daily-use. Restructured:
- **Bottom nav is now 5 tabs**, user-specified order (confirmed via
  clarifying question, since they'd only named 4 of the 5 in prose):
  Overview → Import → **Voice** (center, circular raised button, mic icon,
  not the plain rectangular tab style the other 4 use) → Transactions →
  **Financial Freedom** (nav label shortened to "Freedom" for space; page
  title stays full). Voice and Financial Freedom are new, deliberately
  stubbed pages ("coming soon" + a short description of the eventual
  feature) - Voice previews the Phase 2/3 tap-and-talk plan already in this
  file; Financial Freedom is a brand-new future feature the user described
  inline: compare savings/investments minus liabilities against a "freedom
  number" (~25x average yearly spend) to gauge progress toward financial
  independence. Neither is scoped as a phase yet - do that when the user
  says it's time to build one of them for real.
- **Budgets/Categories/Cards moved into a new account menu** - hamburger
  icon (`icons.jsx: HamburgerIcon`) top-right in the topbar, replacing the
  old plain "username - Sign out" link. Opens a dropdown (`AccountMenu.jsx`)
  showing the username, then Account settings / Cards / Budgets /
  Categories / Sign out. Closes on outside click (a `mousedown` listener,
  cleaned up on unmount) or on picking an item.
- **New `/account` screen** (`pages/Account.jsx`) - currently just shows the
  username (read-only) with "changing your name or password is coming
  soon." The user asked for this entry point to exist now; the actual
  editable-profile/change-password functionality is explicitly deferred,
  same spirit as Voice/Financial Freedom - scope it as its own task when
  asked, it'll need a real backend endpoint (Django doesn't expose password
  change via the API yet).
- All existing routes (`/budgets`, `/categories`, `/cards`) kept working
  exactly as before - only reachable via the account menu now instead of the
  bottom nav, no page logic changed.
Verified via headless Playwright against a throwaway account: nav renders in
the exact specified order, the account menu opens/shows all 4 links + sign
out, navigating from the menu to Cards works, both new stub pages
(`/voice`, `/financial-freedom`) load correctly. Screenshots taken and
visually reviewed in **both** light and dark mode - circular voice button
renders correctly raised/centered, account menu dropdown legible, in both.
`npm run build`/`npm run lint` both clean.

#### Overview filters — 2026-08-15, later still the same day

User picked Overview as the first tab to flesh out, starting with just the
filter bar (chart/content changes explicitly deferred to a later
conversation). Replaced the old weekly/monthly toggle with a richer set,
**defaulting to Month to Date** on load (was previously "weekly"):
- **Date filter** (`pages/Overview.jsx`) - a single select: Last week /
  Month to date / Year to date / Last month / Last year / an `<optgroup>` of
  the last 12 calendar months by name ("August 2026", "July 2026", ...,
  generated via `getRecentMonthOptions()`) / Custom range. Picking "Custom
  range" reveals two native `<input type="date">` fields. The resolved
  range is always shown as plain text (`2026-08-01 to 2026-08-15`) since the
  presets aren't otherwise self-explanatory about the exact end date.
  `getDateRange()` computes the actual `[start, end]` `Date` pair for
  whichever mode is active - MTD/YTD go through today, not to the end of the
  period; "specific month" and Last month/Last year use full calendar
  bounds regardless of today.
- **Category filter** - reuses the same category `<select>` pattern as
  Transactions.jsx (all / uncategorized / each category by name).
- **Min/max amount filter** - two number inputs, wired straight to new
  `amount__gte`/`amount__lte` query params (`amount_min`/`amount_max`) added
  to `TransactionViewSet.get_queryset()` in `views.py` - filters on the raw
  signed `amount` field, so "more than 100" means real spending ≥ $100, not
  absolute value.
- Owner filter (Combined/Soroush/Shiva) kept as-is, just repositioned.
All of these already drive the existing total/by-person/trend/by-category
displays, since Overview was already computing everything client-side from
one `api.transactions.list(...)` call - no separate wiring needed beyond
passing the new params through. Verified via headless Playwright: default
lands on MTD showing the correct 2026-08-01→2026-08-15 range (today is
2026-08-15 in this environment), switching to "July 2026" and to a custom
08-01→08-10 range both resolve correctly, and combining a category + min-
amount filter doesn't error. Screenshots reviewed. `npm run build`/`npm run
lint` and `python manage.py check` both clean.
**Not yet done, by the user's explicit sequencing** - anything about what
the charts/cards *below* the filter bar should look like (e.g. the trend
chart still plots one point per day even across a Last Year range, which
will look dense - the user said they'd describe what they want there next,
so this wasn't touched).

#### Overview content + Income tracking — 2026-08-15, next in the same day

User came back to fill in the content below the filter bar (the "not yet
done" from above), plus a new Income-tracking feature they wanted folded in
at the same time. Confirmed two open questions up front via clarifying
question rather than guessing: (1) the user proposed a pie chart mid-message
then talked themselves out of it - confirmed **no pie chart**, keep the
existing sorted bar chart, just add percentages to it; (2) how income entry
should work - confirmed a **simple manual form** (not a file import), since
paychecks aren't bank exports.

- **New `Income` model** (owner, date, amount, source) + full CRUD
  (`IncomeViewSet`, `/api/income/`, migration `0006_income`) - see Data model
  above for why it's per-occurrence rather than a recurring figure.
- **Import screen now has a mode toggle**: "Import statement" (the existing
  flow, refactored into an `ImportStatement` sub-component with no behavior
  change) vs. "Log income" (new `LogIncome` sub-component) - both live in
  `Import.jsx`. Log income is a small form (person, date, amount, source -
  defaults to today/"Paycheck") plus a list of existing entries with delete
  (no inline edit - correcting a mistake is delete-and-re-add, deliberately
  kept simple).
- **Overview additions**, in the order the user specified (total spent →
  person → trend chart → category bar chart → budget ratio → net):
  - **Transactions count** stat tile, sitting next to Total spent (now a
    2-column `.filter-row` of `.stat-tile`s instead of one full-width tile).
  - **Percentages** on the category bar chart - added to the existing
    tooltip formatter (`$X (Y%)`), no layout change to the chart itself.
  - **Budget vs actual** card - new, only rendered when the active date
    filter represents a full calendar month (`isMonthlyPeriod`: `dateFilter
    === 'mtd'` or a `month:` selection - deliberately *not* shown for
    Last week/YTD/custom ranges, since `Category.monthly_budget` is a fixed
    monthly figure and comparing it against an arbitrary range wouldn't mean
    anything). Reuses the exact meter-bar markup/classes from `Budgets.jsx`
    (`budget-list`/`budget-row`/`meter-track`/`meter-fill`/`over-budget`) for
    a consistent look, but computed from Overview's already-filtered
    transactions rather than a separate endpoint - which means, as a bonus,
    it also works for *past* months (e.g. selecting "July 2026" shows July's
    budget performance), not just the current one like the standalone
    Budgets screen. Categories with no `monthly_budget` set are omitted.
  - **Income vs spending** card - per-person income breakdown (shown under
    the same `!owner` condition as the existing spending-by-person card),
    then Income/Spent/**Net** rows, Net colored green (new `.net-positive`
    CSS class, mirrors `.over-budget` red) or red depending on sign. Income
    is fetched with its own `useEffect`/`api.income.list()` call, filtered by
    owner + the same resolved date range as transactions - not filtered by
    category or amount, since neither concept applies to income.
Verified end-to-end via headless Playwright against a throwaway account:
logged a real income entry through the new UI, confirmed it appears in the
list with a delete button, navigated to Overview and confirmed all new
pieces render (transaction count tile, category-chart percentages implied by
the tooltip formatter, budget-vs-actual meter using a temporarily-set real
`Groceries.monthly_budget=400` reverted immediately after, income-vs-spending
card with correct per-person/net numbers) - screenshot reviewed, matches the
requested layout exactly. All test data (temp user, test income entry, the
temporary budget value) cleaned up afterward; real data (8 cards, 26
categories, 19 transactions, 0 income entries) confirmed unaffected. `npm run
build`/`npm run lint` and `python manage.py check` both clean.

#### Overview polish — 2026-08-15, same day, right after real use

Three fixes from the user actually using the page:
1. **"Income vs spending" now gated behind `isMonthlyPeriod`** (same
   condition as budget-vs-actual) - showing income/net against an arbitrary
   range like Last week is misleading if payday didn't fall in that window.
   The income `useEffect` itself now skips the fetch entirely (not just the
   render) when the period isn't monthly.
2. **"By category" rebuilt from a Recharts vertical `BarChart` into a plain
   list**, reusing the exact `budget-list`/`budget-row`/`budget-header`/
   `meter-track`/`meter-fill` markup as Budgets.jsx and the new
   budget-vs-actual card. Root cause of the reported overlap: Recharts'
   `YAxis` category-label auto-wrap has no real control over line height, so
   long real category names (e.g. "Merchandise & Supplies-Groceries",
   "Transportation-Tolls & Fees") wrapped to 2-3 lines and collided with
   neighboring rows at the old `height={breakdown.length * 36}` sizing. A
   plain list sidesteps the problem entirely (each row is its own flex
   block, wraps however it needs to) and, as a side effect, fixes a second
   complaint for free: percentages are now always visible as text instead of
   only on hover - meaningful since hover doesn't exist on a phone, the
   PWA's primary use case.
3. **Recharts `Tooltip` dark-mode text-color bug, fixed on the remaining
   chart** (spend trend): `contentStyle` set the tooltip's background/border
   but never its text color, so Recharts' hardcoded-dark default text
   rendered black-on-dark-surface in dark mode - unreadable, exactly what
   the user reported for the (now-removed) category chart's tooltip. Added
   explicit `itemStyle`/`labelStyle` with `var(--text-primary)`/
   `var(--text-secondary)`. Worth remembering for any *future* Recharts
   `Tooltip` added anywhere in this app: always set `itemStyle`/`labelStyle`
   explicitly, `contentStyle` alone isn't enough for dark mode.
Unused `Bar`/`BarChart`/`Cell` imports removed from Overview.jsx after the
rewrite. Verified via headless Playwright: Income vs spending confirmed
visible on MTD and gone on Last week; category list screenshotted and
visually confirmed no overlap even with the longest real category names;
dark-mode trend-chart tooltip screenshotted mid-hover and confirmed legible
("08-09" / "Spent : $178.54" both clearly visible). `npm run build`/`npm run
lint` clean. Real data (8 cards, 26 categories - now with real budgets set
on several: Groceries $1000, Eating Out $500, Entertainment $200, House
$500 - 19 transactions) confirmed unaffected throughout.

#### UHFCU import: one-file debit+credit auto-split — 2026-08-15, next

User moved on to a third issuer, UHFCU - Soroush has both a debit and credit
card there, Shiva only a debit card, but critically **the export is the same
file for either case**: one Excel export per person containing every UHFCU
transaction, distinguished only by the export's own "Type" column
("Debit"/"Credit", matched case-insensitively). Header row is 1 (no
preamble, unlike Amex/Discover). User also flagged that inter-spouse
transfers show up as "Withdrawal Transfer"/"Deposit Transfer" in the
Description column - clarified via careful re-reading (not a clarifying
question, the phrasing worked out on close reading) that this was purely
"map the Description column, don't get confused into picking some other
detail field" guidance, **not** a request to exclude transfers the way
credit-card payments are excluded - so transfers import as ordinary
transactions, no `PAYMENT_KEYWORDS`-style filtering added for them. If the
user does want that later, it's a small, well-precedented addition.

Did ask one clarifying question on the real design fork here: auto-split one
upload across both cards vs. upload the same file twice (once per card,
each time keeping only its own type). **User chose auto-split.** Built as
`ColumnMapping.type_column` + `ColumnMapping.alt_card` (see Data model
above) - migration `0007_columnmapping_alt_card_columnmapping_type_column`.
`import_transactions()` resolves each row's destination card before
computing its dedupe key (dedupe key includes card id, so this has to
happen first); `TransactionImportView` validates `alt_card` belongs to the
same owner as the primary card (400 if not) before saving the mapping.
Result now includes `type_mismatches` (same shape/treatment as
`payments_excluded` - a reviewable list, not just a count), for rows whose
type matched neither card - meant to be rare/exceptional in the auto-split
design (unlike the "upload twice" alternative, where skips are the expected
common case).

Also fixed a **latent bug this surfaced**: `category_column`'s auto-detect
hints included `"type"` (leftover from before `type_column` existed as its
own concept), which would have mis-guessed UHFCU's Type column as the
category column. Removed from `category_column`'s hints, added properly to
`type_column`'s.

Frontend (`Import.jsx`, `ImportStatement`): "Type column" and "Alternate
card" added to the mapping form's existing "More information" disclosure,
next to Category column. Alternate card options are computed client-side
(`cards.filter(c => c.owner === selectedCard.owner && c.id !== selectedCard.id)`)
so the dropdown only ever offers the same person's other cards. Result
screen gained a "Review skipped rows" disclosure mirroring the payment one.

Verified end-to-end over real HTTP with a synthetic UHFCU-shaped file
(Amount/Date/Description/Type columns, header row 1, 3 Debit + 2 Credit rows
including a "Withdrawal Transfer" row) against two throwaway sibling cards:
one upload split correctly (3 rows landed on the debit card, 2 on the
credit card, `type_mismatches: []`); the transfer row imported as an
ordinary transaction using the Description column, confirming the
no-exclusion decision; a second file with an unrecognized type value
("Savings") correctly produced `imported: 0` + a populated
`type_mismatches` list rather than being misfiled; attempting an `alt_card`
from a different owner correctly got a 400. Also verified in the browser via
headless Playwright that the "Alternate card" dropdown is properly
owner-scoped (only Soroush's cards appeared, no Shiva cards) - screenshot
reviewed. `npm run build`/`npm run lint` and `python manage.py check` both
clean. All test cards/mappings/transactions cleaned up afterward; real data
(8 cards, 26 categories, 19 transactions) confirmed unaffected - deliberately
did **not** touch the real UHFCU Debit card's already-saved mapping during
verification, to avoid needing the user to redo it.
**Not yet done:** the user hasn't actually run this against their real UHFCU
export yet - next real-world test.

#### Inter-spouse transfer exclusion — 2026-08-15, right after

Immediate follow-up: the user confirmed they *do* want "Online banking
Withdrawal Transfer"/"Online banking Deposit Transfer" excluded from the
ledger, same treatment as credit-card payments. Added as its own thing
rather than folding into `PAYMENT_KEYWORDS` - `TRANSFER_KEYWORDS` +
`is_transfer_description()` in `services.py`, checked right after the
payment check in the row loop, own result field `transfers_excluded` (same
`{date, description, amount}` shape as `payments_excluded`, same
never-imported treatment). Kept separate from payments deliberately: a
credit-card payment and an inter-spouse transfer are different real-world
things even though both are "not spending," and separate keyword lists /
result fields / review sections mean the user can tell which is which and
tune either independently later. `Import.jsx` result screen got a matching
count line + "Review excluded transfer rows" disclosure. Verified end-to-end
over real HTTP with a synthetic file (2 real purchases + both transfer
wordings, mixed case to confirm case-insensitive matching): only the 2 real
purchases imported, both transfers correctly excluded and listed in
`transfers_excluded`. Cleaned up afterward; real data unaffected. `npm run
build`/`npm run lint` and `python manage.py check` clean.

#### UHFCU: symmetric mapping + sign/case confirmation — 2026-08-15, right after

User tried the auto-split feature and flagged three things:
1. **Picking either UHFCU card should behave identically** - "I do not want
   to upload it twice." Root cause: the auto-split design from the prior
   round only configured the *primary* card (whichever was used to first
   set it up) with `alt_card` pointing at its sibling - the sibling itself
   had no `ColumnMapping` at all, so selecting it later would trigger the
   full first-time mapping flow again, and even after that, rows wouldn't
   route correctly unless the user separately set `alt_card` right back
   on that side too. **Fixed**: whenever a mapping with `alt_card` set is
   saved, `import_transactions()` now also mirrors it onto the alt card -
   same columns/type_column/flip_sign, `alt_card` pointing back at the
   original, `header_row` synced too (same file either way, so it must
   match). One setup step now configures both cards; picking either one
   from then on reuses the mapping and auto-splits identically. Verified by
   establishing the mapping via the debit card, confirming the mirrored
   mapping appeared on the credit card automatically, then re-uploading the
   *same* file selecting the credit card as entry point with **zero**
   mapping params - went straight to import (no re-prompt) and all 4 real
   rows correctly deduped against what the first upload had already filed
   under both cards.
2. **UHFCU's sign convention is inverted vs. Amex/Discover** - positive
   means money added (deposit/credit), negative means money out (spending).
   Turned out this needed **no new code** - the existing `flip_sign`
   checkbox ("check this if your export shows spending as negative") was
   built for exactly this case. Confirmed by testing: a -$45.20 spend
   becomes +$45.20 after flip (correctly counted as spending), a +$500
   deposit becomes -$500 (correctly *not* counted as spending). The user
   needs to check "Flip sign" when first mapping either UHFCU card (it's
   part of what gets mirrored/remembered, so only once).
3. **Type column values are "DEBIT"/"CREDIT" (all-caps)** - also needed
   **no code change**: the type-matching logic already lowercases both the
   row's value and `card.type` before comparing, so any casing works.
   Confirmed by testing with all-caps values in the same file as above -
   routed correctly.
Real UHFCU cards' mappings were *not* touched during any of this testing
(all done against throwaway cards) - the user's own first real setup step
(map either UHFCU card once, with Flip sign checked) still needs to happen.
`python manage.py check` clean; no frontend changes this round (the UI
already exposed everything needed - `alt_card`, `type_column`, `flip_sign`
were all already there from the prior round).

#### First real UHFCU import + auto-income — 2026-08-15, right after

User ran a real import against their real UHFCU Credit card and shared the
result log verbatim. Diagnosed three things from it, one of them a live bug
affecting already-imported real data:

1. **`flip_sign` was never turned on for the real UHFCU Credit mapping** -
   confirmed by inspecting the ORM directly (`flip_sign=False`,
   `alt_card=None`). All 8 already-imported transactions turned out to be
   deposits (`ACH Deposit ...`) stored with their *raw* positive sign, which
   the app reads as spending - i.e. real deposits were silently being
   counted as spending in Overview's totals. Root-caused via the ORM, not
   guessed - printed the 8 rows directly.
2. Of the 3 `type_mismatches` in the log, the user confirmed one
   ("ACH Withdrawal SoFi Bank") *should* be excluded (his own SoFi account,
   same idea as the UHFCU-to-UHFCU P2P transfers), and the other two
   ("ARDENT CU", "Amazon web services") should have imported - they didn't
   because `alt_card` was never set on the real mapping, so any `DEBIT`-typed
   row had nowhere to go.
3. New ask: auto-detect "ACH Deposit WSB LLC" (Soroush's employer) as
   income instead of a transaction.

**Code changes** (`services.py`): added `"sofi bank"` to `TRANSFER_KEYWORDS`
(catches both `ACH Withdrawal SoFi Bank` and `ACH Deposit SoFi Bank` - same
substring, both directions). Added a parallel mechanism for income:
`INCOME_KEYWORDS` (list of `(keyword, source_label)` tuples - currently just
`("wsb llc", "Paycheck (WSB LLC)")`) + `match_income_description()`, checked
in the row loop right after the transfer check (income rows need no
type-routing - they never become a Transaction at all). Matched rows are
excluded from the transaction ledger and instead become an `Income` row
(`owner=card.owner`, `amount=abs(amount)` - sign-convention-agnostic,
`source` from the keyword table). **Income has no `dedupe_key` field like
Transaction**, so added ad-hoc dedup by `(owner, date, amount)` before
`bulk_create` - re-uploading the same file must not double-log the same
paycheck. Result dict gained `income_added` (same `{date, description,
amount}` shape as the other review lists). `Import.jsx` result screen got a
matching count line + "Review income added" disclosure pointing at the "Log
income" tab.

**Real data fix** (this was the sensitive part - see reasoning: deleting the
8 stale rows was necessary, not optional, because fixing the mapping and
just re-uploading *without* deleting first would have produced duplicates -
the WSB/SoFi rows would newly resolve to Income/exclusion with the stale
Transaction copies still sitting there, and the Dividend/Venmo rows would
get a *second*, differently-signed copy since their dedupe_key changes once
`flip_sign` flips): directly fixed the real `UHFCU - Credit` `ColumnMapping`
(`flip_sign=True`, `alt_card=`UHFCU - Debit`) via the ORM, manually mirrored
the same mapping onto `UHFCU - Debit` (replicating exactly what
`import_transactions()`'s auto-mirroring does, since this was done outside
the normal upload flow), then deleted the 8 stale transactions after
printing and confirming each one first. Real `UHFCU - Debit` had no
transactions yet, so nothing there needed touching.

Verified the new keyword logic end-to-end over real HTTP against a
throwaway card before touching real data: a real purchase imported
normally, a SoFi deposit was correctly excluded as a transfer, both WSB LLC
rows were correctly logged to Income (`source: "Paycheck (WSB LLC)"`), and
re-uploading the identical file produced `income_added: []` (correctly
deduped) while the purchase counted as a duplicate. Also noticed a real,
pre-existing manual Income entry ($2721.12, source "Paycheck") from the
user's own earlier use of the Log Income form - left untouched throughout.
`npm run build`/`npm run lint` and `python manage.py check` clean.
**Not yet done: the user needs to re-upload their real UHFCU Credit export
one more time** - this will now correctly (re-)import the real spending with
correct signs, split the 2 previously-stuck DEBIT-type rows onto UHFCU
Debit, exclude the SoFi deposit/withdrawal and P2P transfers, and log the
WSB LLC deposits to Income automatically.

#### SoFi Debit prep + a real trap caught before it happened — 2026-08-15, next

User moved to the last card, SoFi Debit (Soroush's direct-deposit account -
no sibling SoFi credit card exists). Columns: Date/Amount/Description
(camelCase-style headers, same as every other issuer so far), header row 1,
same negative=spend/positive=deposit sign convention as UHFCU (so
`flip_sign` needed again). Also has a "Type" column (Zelle, Direct_deposit,
etc.) and the same "WSB LLC" (all-caps) direct-deposit wording as UHFCU.

**Caught a real trap before the user could hit it**, by reasoning through
the existing type-routing code rather than waiting for a bug report: SoFi's
"Type" column is an *activity* label, not a debit/credit split - but
`guess_column_mapping()` auto-suggests any column named "type" as
`type_column` regardless of context (it has no way to know there's no
sibling card). Before this fix, mapping it (even by accepting the
auto-suggestion) with no `alt_card` set would have made *every single row*
fail the `row_type == card.type` check and get silently skipped - the whole
statement would import zero transactions, all dumped into
`type_mismatches`. **Fix**: type-routing now only activates when `alt_card`
is actually set (`services.py`: `if mapping.get("type_column") and alt_card
is not None`) - a mapped-but-unpaired `type_column` is simply ignored, rows
import normally. Updated the "More information" help text in `Import.jsx`
to say this explicitly (leave both blank for a single-account card).
Verified with a synthetic SoFi-shaped file (Rent/Zelle/Internet spending +
a WSB LLC payroll deposit), `type_column` mapped, no `alt_card`: all 3 real
rows imported correctly with correct signs, zero `type_mismatches`, and the
$2500 payroll deposit correctly auto-logged to Income via the existing
(issuer-agnostic) "wsb llc" keyword - no new code needed for that part,
confirming the UHFCU income-detection work carries over to any card for
free. No other new keywords added this round (Amex/Discover payoff wording
on the SoFi side is unconfirmed without the user's real file - existing
`PAYMENT_KEYWORDS` already covers several plausible phrasings; told the user
to check the "Review excluded payment rows" list after their real upload and
report back if anything slips through uncaught, same established workflow
as every prior issuer). `npm run build`/`npm run lint` and `python
manage.py check` clean; all test data cleaned up; real data (8 cards, 26
categories, 23 transactions, 5 income entries) unaffected - the user hasn't
uploaded a real SoFi file yet.

#### SoFi payment/transfer wording + first MerchantRules seeded directly — 2026-08-15, next

Before uploading a real SoFi file, the user gave six description patterns
up front. Split cleanly into two mechanisms, both already existing - no new
concepts, just data:

- **Exclusions** (`services.py`): added bare `"discover"` to
  `PAYMENT_KEYWORDS` (SoFi shows Discover payoffs tersely, no "payment"
  wording - `"amex epayment"` already covered the Amex case). Added
  `"university of hawaii fcu"` to `TRANSFER_KEYWORDS` (UHFCU's legal name,
  seen from the SoFi side). **Caught a real collision before it caused
  data loss**: the existing broad `"sofi bank"` transfer keyword (added
  last round for the UHFCU side) would have also matched "SoFi Bank PL" -
  SoFi's *own* personal-loan payment wording, which is real spending, not a
  transfer. Narrowed it to the two exact confirmed phrasings
  (`"ach withdrawal sofi bank"` / `"ach deposit sofi bank"`) so the loan
  payment can't collide.
- **Auto-categorization**: KAISERMAN→Rent, SoFi Bank PL→Loan, VERIZON→House
  don't need new code at all - `MerchantRule` (keyword → category,
  case-insensitive substring, checked during import) already does exactly
  this. Created the three rules directly via the ORM rather than waiting for
  the user to manually recategorize one transaction of each first (which is
  the normal way `MerchantRule`s get learned - see "Learn from corrections"
  in Key principles).
Verified all six end-to-end over real HTTP with a synthetic file covering
every pattern: AMEX EPAYMENT and DISCOVER excluded as payments, UNIVERSITY
OF HAWAII FCU excluded as a transfer, and KAISERMAN/SoFi Bank PL/VERIZON all
imported with the correct category (1/4/2 → confirmed Rent/Loan/House) -
critically confirming the SoFi Bank PL row was *not* caught by the
transfer-keyword narrowing. `python manage.py check` clean; no frontend
changes this round. All test data cleaned up; real data (8 cards, 26
categories, 23 transactions, 5 income entries, and now 3 real
`MerchantRule`s) confirmed unaffected/correctly seeded. User hasn't
uploaded their real SoFi file yet - next step.

#### Transactions tab gets the same filters as Overview — 2026-08-15, next

Real SoFi upload succeeded in between (confirmed live in the Transactions
screenshot below - KAISERMAN showing "Rent", Zelle payments, real spending -
no separate note needed, nothing to fix there). User then asked for
Transactions to get the same date-range filtering Overview has (Last
week/MTD/YTD/Last month/Last year/specific month/custom), plus a min/max
amount filter - owner/card/category/search already existed. "Transactions
with no category" was already covered by the existing Uncategorized option
in the category dropdown, so nothing new needed there.

Rather than duplicate Overview's ~80-line date-range engine and its filter
JSX a second time, extracted both into shared pieces first:
- **`frontend/src/dateFilters.js`** - `toISO()`, `getRecentMonthOptions()`,
  `getDateRange()`, unchanged logic, just moved out of `Overview.jsx`.
- **`frontend/src/DateFilter.jsx`** - the date `<select>` (with the
  "Specific month" optgroup) + conditional custom-range inputs + resolved
  "YYYY-MM-DD to YYYY-MM-DD" text, as one component. Takes the date-filter
  state as controlled props and a `children` slot so the calling page can
  drop its own owner/combined select into the *same* `.filter-row` (keeps
  the exact layout both pages already had - date select and owner select
  side by side).
`Overview.jsx` now imports both instead of defining them locally - refactor
only, no behavior change (verified via build). `Transactions.jsx` gained
`dateFilter`/`customStart`/`customEnd`/`amountMin`/`amountMax` state, the
same `<DateFilter>` usage, and `amount_min`/`amount_max` added to its
`api.transactions.list(...)` call (backend support already existed from the
Overview round). Defaults to Month to Date, matching Overview, since the
user didn't specify a different default and app-wide consistency seemed
like the better call than preserving the old "shows everything" behavior.

Verified via headless Playwright: default lands on MTD, switching to Year
to date pulls in older real transactions (40 rows - confirms the date
filter isn't accidentally still hardcoded/ignored), the Uncategorized
category filter narrows correctly (16 of those 40), and Min $100 narrows
further (9). Screenshot reviewed - real data renders correctly with the new
filter layout, categories/colors intact. `npm run build`/`npm run lint`
clean. Real data (8 cards, 26 categories, 40 transactions, 6 income entries)
confirmed unaffected throughout - transaction/income counts are higher than
last recorded because the user's real SoFi upload landed in between
sessions, not from anything done this round.

#### Min/Max amount filter sign bug — 2026-08-15, next

User caught it live: setting Max $10 was also showing large refund/
income-like transactions (a real example: a -$914.60 Venmo deposit). Root
cause: `amount_min`/`amount_max` (`TransactionViewSet.get_queryset()` in
`views.py`) filtered the *raw signed* `amount`, but this app stores
refunds/deposits/income-like rows as negative (displayed with a green "+" -
see the UHFCU/SoFi sign-convention work earlier the same day). Any negative
number trivially satisfies a small `amount <= max`, so a huge deposit
sailed straight through a "Max $10" filter meant to mean "small
transactions only". **Fixed** by comparing against the displayed magnitude
instead: `qs.annotate(abs_amount=Abs("amount"))` (from
`django.db.models.functions`), then filtering `abs_amount__gte`/`__lte`
rather than `amount__gte`/`__lte`. One shared fix in the one endpoint both
Overview and Transactions call - no frontend changes needed. Verified
directly against real data: Max=10 now correctly excludes the real -$914.60
deposit (only returning genuinely-small-magnitude rows, including small
negative ones like -$7.00 and -$0.01, which is correct - their displayed
magnitude really is small), and Max=1000 correctly includes it again.
`python manage.py check` clean.

#### "Cash in / Cash out" filter — 2026-08-15, next

User wanted a filter for money-in vs. money-out on both Overview and
Transactions, explicitly not wanting it called "income"/"spending"/anything
synonymous with "earned" - asked a quick clarifying question on exact
wording rather than guessing (worth it: got "Cash in"/"Cash out" back,
which reads a bit differently than what "Recommended" would have been).
New `direction` query param on `TransactionViewSet.get_queryset()`
(`views.py`): `"in"` → `amount__lt=0`, `"out"` → `amount__gt=0`, same sign
convention as the Min/Max fix earlier the same day (spending stored
positive, refunds/income-like rows negative). Third `<select>` added to
both pages' filter rows (Cash in & out / Cash out / Cash in), wired into
each page's existing `api.transactions.list(...)` call - purely additive,
composes with every other filter via AND (e.g. "Cash out" + "Max $100" =
small real purchases only).

Verified end-to-end against real data via headless Playwright: on
Transactions, "Cash in" returned exactly 9 rows (all rendering with the
green "+" the app already uses for negative-stored amounts), "Cash out"
returned exactly 31, and 9 + 31 = 40 = the true unfiltered total (confirmed
against a correctly-timed baseline read, after the first attempt raced
ahead of a debounced fetch and gave a stale count - script timing, not an
app bug). On Overview, filtering to "Cash in" only correctly zeroes out
"Total spent" (which by design only ever sums `amount > 0`, i.e. cash-out
rows) - expected behavior, not a bug, since Overview's other cards
(by-person, trend, by-category, budget-vs-actual) are all spending-scoped
by the same convention. Screenshot reviewed - also incidentally
reconfirmed VERIZON→House and SoFi Bank PL→Loan `MerchantRule`s are
working correctly against the user's real imported data. `npm run
build`/`npm run lint` and `python manage.py check` clean.

#### Overview adapts to "Cash in" — 2026-08-16, next

User caught it immediately after the Cash in/out filter shipped: every card
on Overview is spending-scoped by design (Total spent, By person, Spend
trend, By category, Budget vs actual, Income vs spending all only ever sum
`amount > 0`), so selecting "Cash in" zeroed out or emptied literally
everything - not a bug in the filter itself, but the page had nothing
sensible to show for the opposite case. User's own spec: swap Total
spent → "Total earned" and By person → earned-per-person, hide everything
else (Spend trend, By category, Budget vs actual, Income vs spending)
rather than trying to adapt them too - built exactly that, no more.

`isCashInOnly = direction === 'in'` gates the JSX; two new `useMemo`s
(`totalEarned`, `earnedByPersonTotals`) mirror the existing spend
computations but sum `amount < 0` rows via `Math.abs()` instead of `> 0`.
Total earned reuses the `.net-positive` (green) class for visual
consistency with how earned/refund amounts are already shown elsewhere.
Transaction count and the date/owner/category/cash-direction/amount filter
controls themselves stay visible always - only the spending-shaped content
cards are conditionally hidden. Budget vs actual and Income vs spending
already had an `isMonthlyPeriod` gate from earlier the same day; added
`!isCashInOnly &&` alongside it rather than replacing it.

Verified via headless Playwright against real YTD data: selecting Cash in
shows exactly three card sections (Total earned/Transactions/By person,
confirmed via their actual rendered `.muted.small` titles) with none of the
other four; switching to Cash out restores the full set. Screenshot
reviewed - Total earned renders in green, matches the requested layout
exactly. `npm run build`/`npm run lint` clean; real data (8 cards, 26
categories, 40 transactions, 6 income entries) unaffected throughout.

#### Overview: dropped the combined cash-direction option — 2026-08-16, next

Quick follow-up: on Overview specifically (not Transactions, which keeps
all three), removed the "Cash in & out" option from the direction filter -
now just Cash out / Cash in, defaulting to Cash out (`direction` state
default changed from `''` to `'out'`). Makes sense given the prior round's
work: Overview's content is either spending-shaped or earned-shaped
depending on `isCashInOnly`, so there's no coherent "both at once" view to
default to anyway - every page load now lands on a real, populated state
instead of the old combined default. Verified via headless Playwright:
default value is `'out'`, dropdown has exactly two options. `npm run
build`/`npm run lint` clean.

#### Import: review-before-commit for new transactions — 2026-08-16

User's ask: bank exports carry their own category labels (e.g. "Merchandise-
Groceries", "Restaurant-Coffee") that don't match our 15 curated categories,
so every newly-imported transaction should be shown to the user for review
- editable description and category - with an explicit approve step, instead
of committing straight to the ledger with whatever label the bank happened
to use. Goal: no duplicate/near-duplicate categories accumulating from raw
bank labels.

Implemented as a two-step, **stateless** flow (no new `ImportDraft` model -
weekly batches are small, and nothing is written to the DB until the user
approves, so there's nothing meaningful to persist server-side in between):

1. `POST /api/import/` (existing endpoint, `TransactionImportView`) now stops
   short of `bulk_create` for net-new rows. `import_transactions()` in
   `services.py` returns a `pending_transactions` list instead - each row has
   `key` (the would-be dedupe_key), `date`, `original_description`
   (immutable, drives dedup), `description` (editable), `amount`, `card_id`/
   `card_name`, and either a resolved `category_id`/`category_name` (already
   matched via `MerchantRule`) or a `category_label` (the bank's own raw
   label, offered as a "(new)" suggestion, not yet created as a real
   `Category` row). Added `find_category_by_label()` - a pure lookup,
   deliberately separate from the pre-existing `get_or_create_category_from_
   label()` - so *nothing* gets created during preview even if the batch is
   later discarded. Duplicate rows (already in the ledger) and auto-detected
   income still commit immediately as before - review only applies to
   genuinely new spending rows, since those are the only ones with a real
   category ambiguity.
2. `POST /api/import/confirm/` (new endpoint, `TransactionImportConfirmView`
   → `commit_import_rows()`) takes the reviewed/edited rows back and does the
   actual `bulk_create`. Re-checks dedupe at commit time rather than trusting
   the preview is still current. Critically, the dedupe_key is always
   computed from `original_description`, never the user's edited
   `description` - so renaming "WALMART SUPERCENTER" to "Walmart - weekly
   groceries" during review doesn't break dedup the next time that same
   merchant string shows up in a real export.

Frontend (`Import.jsx`): after upload, if `pending_transactions` is
non-empty, shows an inline review list (one card per row - text input for
description, `<select>` for category, pre-selected to the MerchantRule match
or the bank's "(new)" suggestion) instead of the old immediate result
screen. "Approve & import N" posts to `/import/confirm/` and merges its
result with the preview's own `duplicates_skipped` (both counts matter -
some rows may already have been dupes before review even started; don't let
one overwrite the other). Went with this inline-card pattern rather than a
true modal, matching how the existing mapping-required step already works
in this same file - simpler and more mobile-friendly than a popup, was a
judgment call rather than a literal read of "pop-up."

Verified end-to-end with a throwaway `_verify_temp` user/card and a 3-row
synthetic file via real HTTP (curl) and headless Playwright:
- Preview correctly matched the pre-existing `kaiserman`→Rent `MerchantRule`
  (category_id pre-filled) while the other two rows surfaced their bank
  labels as "(new)" - confirmed via direct DB query that zero Transactions
  and zero new Categories existed at this point.
- Edited one row's description and overrode another row's category
  (declining its "(new)" suggestion in favor of an existing category) before
  approving; confirmed via ORM that the committed transaction reflected the
  *edited* description, the override category actually took effect (the
  declined suggested category was never created), and the accepted "(new)"
  suggestion *was* created as a real Category.
- Re-uploaded the identical original file afterward and got exactly 3
  `duplicates_skipped`, 0 new pending rows - proving dedup keys off
  `original_description` survived the cosmetic edit from the prior step.
- Playwright screenshot confirmed the review UI renders correctly (3 cards,
  editable inputs, correct pre-selected dropdowns) and the "Import complete"
  result screen renders after approval, with zero console errors throughout.
- All test data (`_verify_temp` user, `__VERIFY_REVIEW__` card, its 3
  transactions, the one newly-created placeholder category) deleted
  afterward; real data confirmed unchanged (8 cards, 26 categories, 40
  transactions). `npm run build`/`npm run lint` and `python manage.py check`
  clean throughout.

#### Delete confirm dialog + two live UI bugs fixed - 2026-08-16

User asked for an in-app confirm popup before deleting a transaction,
category, or card (Categories/Cards already used `window.confirm`;
Transactions didn't). Built `frontend/src/ConfirmDialog.jsx` - a reusable
card-styled dialog (title/message/Cancel/Delete, dismissible via backdrop
click or Escape) - reusing the app's existing `.card` look rather than the
native browser popup, and wired it into Transactions/Categories/Cards, each
tracking a `pendingDelete` item in state instead of calling
`window.confirm` directly.

User then reported two live bugs in the result: the transaction row's
Delete button was invisible ("red on red"), and on phone width it rendered
outside the transaction card/off-screen. Root-caused both via direct DOM
measurement (Playwright `getBoundingClientRect`/`getComputedStyle`), not
guessed:
1. The dialog's new `button.danger` CSS rule (solid red fill, added for its
   own Delete button) collided with the pre-existing `.link-button.danger`
   class already used on every row-level Delete trigger (Transactions,
   Categories, Cards, and the Import screen's income-entry delete) - CSS
   specificity split text-color and background-color across the two rules,
   landing on red-on-red. Fixed by renaming the dialog's own button to a
   non-colliding class, `.dialog-confirm`.
2. `.transaction-actions select` (the row's category dropdown) had no
   `min-width` override, so flexbox refused to shrink it below its content
   width on transactions with long category names (e.g. "Merchandise &
   Supplies-Groceries"), pushing the Delete button up to 33px past a
   375px-wide viewport. Fixed with `min-width: 0` on the select (so it
   truncates with an ellipsis) and `flex-shrink: 0` on the button.
Verified at 375px in both light and dark mode, including the row with the
longest real category name, via a throwaway account/data (deleted
afterward); `npm run build`/`npm run lint` clean; real data (8 cards, 27
categories, 41 transactions, 6 income entries) unaffected throughout.

#### Financial Freedom: net worth tracker + freedom-number goal - 2026-08-16

Built out the previously-stubbed Financial Freedom tab per the user's spec:
each owner enters their savings/investment/loan/other asset-liability
accounts and a personal "average yearly expense" estimate; the freedom
number is 25x the *combined* household yearly expense (both owners'
estimates summed - the literal reading of "25 * medium yearly expense for
household"); progress is shown against that freedom number plus five fixed
motivational milestones ($1k/$10k/$50k/$100k/$200k, not user-configurable);
net worth is derived from manually-logged balance snapshots per account
(same "logged per occurrence" pattern as Income) rather than tied to the
Transaction/Income ledger directly - deliberately kept separate, since
spending categories and account balances are different concepts and tying
them together would have meant guessing at a reconciliation model the user
never asked for.

**Backend** (migration `0008_networthaccount_yearlyexpense_networthentry`):
- `NetWorthAccount` (owner, name, category - `savings`/`investment`/`loan`/
  `asset`/`liability`, the last two as free-form catch-alls for anything
  beyond the three named buckets the user called out; `is_liability`
  derived from category) and `NetWorthEntry` (account FK, date, balance -
  `unique_together` on account+date). `NetWorthAccountViewSet`/
  `NetWorthEntryViewSet` (full CRUD, same filter-by-owner pattern as
  Income); `NetWorthEntryViewSet.create()` upserts on a duplicate
  account+date instead of 409ing, since re-checking and re-logging today's
  already-logged balance is a plausible normal action, not an error.
- `YearlyExpense` (owner OneToOne, amount) - a single current value per
  owner, not a history (unlike net worth itself) - via `YearlyExpenseView`
  (GET returns both as `{username: amount}`, POST sets one owner's value;
  either user can set either owner's value, same no-permissions pattern as
  the rest of the app).
- `FreedomSummaryView` (`/api/networth/summary/`) - computed, on the fly,
  no caching (2-user personal scale doesn't need it): net worth as of any
  date from each account's latest entry at-or-before that date (assets add,
  liabilities subtract), current household net worth + per-owner
  breakdown, `freedom_number` (null until both/either yearly expense is
  set), the fixed milestone list, `next_goal`/`amount_to_next_goal`/
  `amount_to_freedom`/`percent_to_freedom`, and a `history` series (one
  point per distinct entry date across all accounts, each computed via the
  same as-of-date logic) for the trend chart.
- Verified the full computation end-to-end via curl against a throwaway
  account/data before touching the frontend: net worth math, the upsert
  behavior (re-logging the same account+date updates in place, confirmed
  via a before/after read), and history fill-forward (a later account's
  entry doesn't retroactively affect an earlier date's computed total) all
  confirmed correct against hand-computed expected values.

**Frontend** (`pages/FinancialFreedom.jsx`, full rewrite of the stub):
stat tiles for current net worth and the next unmet goal (whichever of the
five milestones or the freedom number is soonest); a by-person net worth
breakdown (reusing Overview's `person-stats`/`legend-dot` pattern); a
"Path to freedom" list - one row per milestone plus the freedom goal,
each with its own mini progress bar and "$X to go"/"Reached" - deliberately
built as a list rather than a single bar with six crowded labels, applying
the same lesson already learned this project from the Overview category-
chart rebuild (2026-08-15: Recharts labels overlapping on mobile); a net
worth history chart (Recharts `AreaChart`, same dark-mode-safe
`itemStyle`/`labelStyle` Tooltip fix as Overview's spend trend), shown only
once 2+ history points exist; then the setup forms - average yearly
expense (one input + Save per owner) and accounts (new-account form +
list, each account showing its latest balance and an inline "log a new
balance" mini-form, Delete behind the new `ConfirmDialog`). Guarded two
edge cases found while verifying: a negative net worth (liabilities >
assets, plausible for e.g. a household early in paying down loans) both
clamps every progress-bar width to 0% instead of going negative, and
displays correctly as `-$5,000` rather than `$-5,000`.

Verified end-to-end via headless Playwright at 375px width, light and dark
mode, using a throwaway account/data (deleted afterward): empty state,
setting both owners' yearly expenses, adding a savings account and logging
a balance (freedom number and goals list update correctly), a second
older-dated balance producing a real 2-point history chart, the delete
confirm dialog, and a deliberately negative-net-worth scenario (loan
account with no offsetting assets) - all rendered correctly with zero
console errors. `npm run build`/`npm run lint` and `python manage.py check`
clean throughout. Real data (8 cards, 27 categories, 41 transactions, 6
income entries) confirmed unaffected; no real net worth accounts or yearly
expenses have been entered yet - next step is the user's own real setup.

#### Financial Freedom simplified + net worth setup split out to its own settings page - 2026-08-16, right after

User tried the first Financial Freedom build and found the "all 6 goals at
once" list overwhelming/discouraging, and asked for setup (accounts,
yearly expense) to move out of the daily-use tab entirely, into
"set once, revisit rarely" settings - same reasoning already applied to
Budgets/Categories/Cards in the 2026-08-15 nav restructure. Two changes,
no backend changes needed (the existing `FreedomSummaryView`/
`NetWorthAccountViewSet`/`YearlyExpenseView` already returned everything
needed):

- **`pages/FinancialFreedom.jsx` cut down to just the daily-glance view**:
  household net worth (stat tile) → by-person breakdown → exactly two
  progress bars, always both, each showing a percentage: "Next goal"
  (whichever of the five fixed milestones or the freedom number is
  soonest - `current / next.amount * 100`, capped 0-100) and "Financial
  freedom" (`current / freedom_number * 100`, with a prompt in place of the
  bar when no yearly expense is set yet). The old "Path to freedom" list
  (all 6 goals shown at once) and the account-management card are both
  gone from this page - removed, not collapsed, per the user's explicit
  "seeing all the steps at once is discouraging."
- **New `pages/NetWorthAccounts.jsx`** (route `/networth-accounts`, added
  to `AccountMenu.jsx`'s `MENU_LINKS` alongside Cards/Budgets/Categories):
  average yearly expense (per owner, moved verbatim from the old page) at
  top, then **Assets** and **Liabilities** as two separate segments (split
  by `NetWorthAccount.category` - savings/investment/other-asset vs. loan/
  other-liability) - each its own card with a header total (`$X`) and a
  bar (both bars scaled to the same `max(totalAssets, totalLiabilities)`
  so their relative size is visually comparable) plus its own list of
  accounts (name, category, latest balance, inline log-balance form,
  delete). Adding a new account is a native `<details>`/`<summary>`
  "Add account" disclosure below both segments, collapsed by default -
  same zero-JS collapsible pattern already used for Import's "More
  information" sections, confirmed collapsed-by-default via a direct
  `element.open` check in Playwright, not just visually.

Root-caused one thing during verification that turned out not to be a real
bug: a test run produced 400s on account creation - traced to the test
script reusing account names across two colorScheme runs without cleanup
in between, correctly rejected by the pre-existing `unique_together =
[("owner", "name")]` constraint (confirmed by replaying the same payload
directly through `NetWorthAccountSerializer` in a shell and reading the
validation error), not an application bug.

Verified end-to-end via headless Playwright at 375px width, light and dark
mode, with a throwaway account/data (deleted afterward, confirmed via a
direct DB count): empty states for both pages, setting both owners'
yearly expenses, adding one asset and one liability account with balances,
confirming the two Financial Freedom bars update correctly (percentage and
"$X to go" math checked against the underlying numbers), and the
`NetWorthAccounts` link appearing correctly in the hamburger menu. `npm
run build`/`npm run lint` and `python manage.py check` clean throughout.
Real data (8 cards, 27 categories, 41 transactions, 6 income entries)
confirmed unaffected; still no real net worth accounts/yearly expenses
entered - next step is the user's own real setup via the new settings page.

#### Financial Freedom v3: household/individual expense toggle, assets & liabilities on the daily tab too - 2026-08-16, right after

User's follow-up correction to the v2 split: the daily-use/settings split
itself was right, but two things landed in the wrong place, plus a real
layout bug:
1. Average yearly expense should support **either** a single shared
   household number **or** per-person numbers, toggleable - not two
   always-visible per-person inputs. "It doesn't matter [which], I think
   it's good to add household as well."
2. The **Assets/Liabilities segments belong on the Financial Freedom tab
   itself** (the user's original ask), not only in settings - settings
   keeps them too (that's where "Add account" and balance-logging/delete
   live), but Financial Freedom should *show* them (read-only) as part of
   the daily glance, specifically below a "Path to financial freedom" bar
   (get to 25x household yearly expense) that sits under the existing
   "Next goal" bar.
3. The household net worth tile wasn't taking the full card width -
   traced to a leftover inline `alignSelf: 'flex-start'` style from the
   v2 build (meant to keep it from stretching in a two-tile row that no
   longer exists) overriding the `.stack` flex column's default
   stretch-to-fill behavior. Removed; no CSS changes needed since every
   other card in this app already relies on that same default stretch.

**Backend**: `YearlyExpense.owner` (FK to User) replaced with `scope`
(`CharField`, choices `household`/`soroush`/`shiva`, unique) - migration
`0009_remove_yearlyexpense_owner_yearlyexpense_scope` (no real data
existed yet, confirmed via the ORM before migrating, so this was a clean
replacement, not a data migration). `YearlyExpenseView` GET now returns
`{scope: amount}` for whichever scopes are set; POST takes `{scope,
amount}`. New `household_yearly_expense_from(expenses)` helper in
`views.py`, used by `FreedomSummaryView`: if a `household` scope value is
set, it wins outright (a direct answer, not derived); otherwise falls back
to summing whichever of `soroush`/`shiva` are set - same "household
overrides, else sum individuals" behavior confirmed end-to-end via curl
(set soroush=25000 + shiva=15000 → household_yearly_expense 40000 →
freedom_number 1,000,000; then set household=50000 directly → overrides
to household_yearly_expense 50000 → freedom_number 1,250,000, individual
values untouched but no longer used).

**Frontend**:
- `NetWorthAccounts.jsx`'s yearly-expense card now uses a three-way
  `.user-toggle` (Household/Soroush/Shiva - the same segmented-pill
  component already used for the Login screen's person picker) instead of
  two stacked inputs. Switching scopes swaps in that scope's already-
  fetched value via a `useEffect` keyed on `[expenses, expenseScope]`
  (kept as an effect rather than inline in the scope-change handler
  specifically to avoid a stale-closure lint warning from `load()`
  otherwise needing `expenseScope` in scope - `npm run lint` stayed
  clean). Assets/Liabilities segments + "Add account" disclosure are
  unchanged from v2 - confirmed still fully functional (log balance,
  delete) since this page remains the one place that manages accounts.
- `FinancialFreedom.jsx` reordered to the user's explicit spec: net worth
  (now full-width) → by-person → Next goal bar (unchanged) → new "Path to
  financial freedom" bar (same 25x-yearly-expense math as before, just
  re-labeled and given its own small header to match the user's wording)
  → **new read-only Assets and Liabilities segments** (a small local
  `Segment` component - title/total/bar/account list, no log-balance or
  delete controls, since editing stays settings-only) → the net-worth-
  over-time chart at the bottom, unchanged. Fetches both
  `api.networth.summary()` and `api.networth.accounts.list()` now (was
  summary-only in v2).

Verified end-to-end via headless Playwright at 375px width, light and
dark mode, with a throwaway account/data (deleted afterward, confirmed via
a direct DB count): the toggle correctly shows an empty input when
switching to a scope with no value set, and correctly preserves the
household value when switching away and back (i.e. saving Soroush's value
doesn't leak into or overwrite the household field); net worth tile width
measured directly (343px = the 375px viewport minus the page's 16px
padding on each side - genuinely full-width, not just visually close);
Assets/Liabilities segments render identically in structure on both pages
with correct totals/bars/lists. `npm run build`/`npm run lint` and `python
manage.py check` clean throughout. Real data (8 cards, 27 categories, 41
transactions, 6 income entries) confirmed unaffected; still no real net
worth accounts or yearly expenses entered - next step is still the user's
own real setup.

Key frontend files: `frontend/src/api.js` (API client), `AuthContext.jsx`,
`App.jsx` + `Layout.jsx` (routing/shell), `AccountMenu.jsx` (account
dropdown, incl. the Net worth accounts link), `icons.jsx` (inline SVG
icons), `ConfirmDialog.jsx` (shared card-styled confirm dialog, used by
Transactions/Categories/Cards/`NetWorthAccounts`), `DateFilter.jsx` +
`dateFilters.js` (shared date-range filter, used by Overview and
Transactions), `pages/*.jsx` (the ten screens, incl. the import-review
step in `Import.jsx`, the daily-glance net worth progress + read-only
asset/liability segments in `FinancialFreedom.jsx`, and its setup
counterpart - yearly expense toggle, full account management - in
`NetWorthAccounts.jsx`), `index.css` (all styling, light/dark via
`prefers-color-scheme`), `vite.config.js` (dev server + `/api` proxy).
Key backend files: `backend/expenses/{models,views,serializers,services,auth,urls}.py`,
`backend/config/settings.py` (CORS/CSRF/ALLOWED_HOSTS, incl. Codespaces auto-detect).

#### Display-only username capitalization fix - 2026-08-16, right after

User noticed "soroush"/"shiva" showing lowercase somewhere in the UI.
Found two spots that displayed the raw `user.username` directly instead of
capitalizing it the way every other place in the app already does (the
`o[0].toUpperCase() + o.slice(1)` pattern used throughout Login/Cards/
Transactions/etc.): the hamburger account-menu header
(`AccountMenu.jsx`) and the read-only Username field on the Account
settings screen (`pages/Account.jsx`). Fixed both to capitalize for
display only - the underlying Django `username` values (and everything
sent to `/api/auth/login/`) stay lowercase, since that's the real login
credential tied to the actual `soroush`/`shiva` accounts and changing it
would have broken sign-in. Verified with a throwaway lowercase-username
account: login still succeeds end-to-end, and both spots now render the
capitalized form ("Verifytemp"). Real accounts confirmed unaffected
(`soroush`, `shiva` still the only two users, unchanged). `npm run
build`/`npm run lint` clean.

#### Transaction detail fields, manual add + duplicate finder, account settings — 2026-08-16, later the same day

A run of smaller features, each verified end-to-end with throwaway
accounts/data via headless Playwright + curl before/after real-data counts,
in this order:

- **Notes/location/tags on transactions** (see Data model above for the
  `Transaction`/`Tag` fields) - editable per-transaction on the
  Transactions screen. First built as inline auto-save-on-blur fields, then
  **replaced with an explicit Edit dialog** (category/notes/location/tags,
  with Cancel/Save) per user feedback - on-the-fly edits felt risky to mess
  up. Where/Tags are a small search-as-you-type combobox (shared
  `Combobox.jsx`: type to filter existing values, click to select, type a
  new value and hit Enter to create it) rather than a native `<datalist>`,
  which didn't give a real "pick from filtered matches" experience. One
  real bug caught during verification: the combobox dropdown was
  `position: absolute` and got silently clipped by the Edit dialog's own
  `overflow-y: auto` - fixed by rendering it in normal document flow
  instead of floating. Transaction cards were also reflowed per user
  spec: description+amount on top, date/category below, uploader/card
  below that, tags as pill labels at the very top.
- **Manual "Add transaction"** - a single hand-typed transaction (not a
  bulk import), `source="manual"`. Lives as a third toggle on the Import
  screen (order: Import statement / Add transaction / Log income) and as a
  "+ Add transaction" button on the Transactions screen that opens the
  same form in a pop-up dialog (originally a collapsible `<details>`,
  changed to a dialog per user feedback). Shared `AddTransactionForm.jsx`
  used in both places. Includes the **duplicate finder** described in Key
  principles above - `TransactionViewSet.create()` pre-checks for an
  existing same-card/date/amount row and returns `possible_duplicate` +
  the match instead of creating, so the frontend can show a "Possible
  duplicate - add anyway?" confirm (`ConfirmDialog` gained a
  `confirmVariant="primary"` option so this reads as a question, not a
  delete warning) rather than either silently skipping (which would be
  wrong here, since a hand-typed description can legitimately differ from
  an already-imported one for the same purchase) or silently allowing a
  likely double-entry. A byte-identical resubmit (same description too)
  still hard-blocks even after confirming - that's a real double-submit,
  not a judgment call.
- **Password change** (`pages/Account.jsx`) - `POST
  /api/auth/change-password/`, validated through Django's standard
  password validators, `update_session_auth_hash` so the current session
  survives its own password change instead of getting logged out mid-request.
- **Username change** - the bigger of two options offered (vs. a cosmetic
  display-name field) - actually renames the Django `username` used to log
  in. This meant `username` could no longer be hardcoded as a literal
  `'soroush'`/`'shiva'` string anywhere, which it was in ~8 frontend files
  (Login's toggle, every owner filter dropdown, Overview's per-person
  totals/colors, NetWorthAccounts' account-owner picker). All replaced with
  a shared `useUsers()` hook backed by a new public `GET /api/auth/users/`
  (ordered by id - needed pre-login by the Login screen, not sensitive,
  just `{id, username}` for the two accounts). Overview/FinancialFreedom's
  per-person colors are now assigned by *position* (lower user id = first
  color) rather than by username, so a rename doesn't shuffle them.
  **`YearlyExpense.scope`'s `"soroush"`/`"shiva"` values were deliberately
  left as fixed internal keys, not tied to the live username** - mapped to
  whichever user has the lower/higher id, so a rename can't orphan an
  already-recorded yearly-expense number; only the displayed label next to
  the toggle is dynamic. Verified with two throwaway accounts (real
  soroush/shiva permanently occupy id-order slots 0/1, so a throwaway
  rename couldn't exercise that specific slot-relabeling path directly -
  confirmed instead that the real accounts' labels/values were completely
  unaffected by the unrelated throwaway rename, and that the slot logic is
  sound by construction since id never changes). **Caught and fixed a real
  mistake mid-session**: a test-data seed script used
  `update_or_create` on `YearlyExpense` for scopes `"soroush"`/`"shiva"`
  without first checking whether real values already existed there -
  overwrote them with test numbers. Caught via a pre-existing
  `household=$40,000` row the script never touched and suspiciously
  sequential ids on the two overwritten rows (strong evidence they were
  freshly created, not real data) - reverted by deleting them back to the
  "unset" state. **If a real per-person yearly-expense value was set
  before this, it's gone and needs to be re-entered** - the household
  value was never touched.

`npm run build`/`npm run lint` and `python manage.py check` clean
throughout. Real data (8 cards, 27 categories, 41 transactions, 6 income
entries, `soroush`/`shiva` still the only two users) confirmed unaffected
at every step.

**Next up: voice-to-text capture, feeding into Ollama for structured
extraction** (Phase 2 + 3 below) - the natural next addition now that manual
single-transaction entry exists as a pattern to extend (voice will land as a
third `source` alongside `import`/`manual`, going through the same
draft-before-commit principle already established for bank-label
categorization). Voice-to-text itself is self-hosted Whisper/
`faster-whisper` (Phase 2); Ollama's job is turning that raw transcript
into structured `{amount, merchant, category, owner}` (Phase 3) - see the
Stack section above for why that split.

#### Voice capture (Phase 2+3) + Oracle Cloud deploy prep — 2026-08-19

Built voice-to-text + LLM parsing (Phases 2 and 3 together, since they turned
out to have no natural stopping point in between once actually building
them), plus the infrastructure to deploy the whole app to the user's Oracle
Cloud Free Tier ARM Ampere A1 instance (already provisioned, real domain
available). Local build+verify first, deploy prep second, per the user's
explicit sequencing.

**Voice capture** - deliberately reuses existing pieces instead of adding a
VoiceDraft model or a second commit endpoint (see the updated Data model
entry above):
- `transcribe_audio()`/`parse_voice_transcript()` (`services.py`) - a
  lazily-loaded, module-level `faster-whisper` model (`WHISPER_MODEL` env,
  default `base.en`, CPU/int8) transcribes the recording; `parse_voice_
  transcript()` then asks the self-hosted Ollama model (`OLLAMA_URL`/
  `OLLAMA_MODEL` env, default `phi3`) to extract `{amount, merchant,
  category, owner, notes}` via `format: "json"`, and resolves the free-text
  category/owner guesses against real data - `categorize_by_merchant()`
  (existing MerchantRule lookup) first, falling back to an exact
  case-insensitive `Category`/`User` match. **Never auto-creates a Category**
  from the LLM's guess (unlike the bank-import label case, an LLM guess isn't
  a fixed vocabulary) - an unmatched guess just leaves the draft
  uncategorized for the user to pick. Any Ollama failure (unreachable, bad
  JSON) is caught and falls back to an unresolved draft rather than a 500 -
  the transcript alone is still useful even if parsing breaks.
- New stateless `POST /api/voice/capture/` (`VoiceCaptureView`) - transcribes
  + parses, returns the draft, writes nothing to the database. Same
  precedent as import's `pending_transactions` preview.
- `TransactionCreateSerializer` gained an optional `source` field
  (`"manual"`/`"voice"` only - `"import"` explicitly rejected, since bulk
  statement rows always go through `commit_import_rows` instead) so the
  existing manual-add path can also produce `source="voice"` rows.
- `AddTransactionForm.jsx` gained optional `initialValues`/`source` props
  (backward compatible - both existing call sites, Import's "Add
  transaction" tab and Transactions' add dialog, are unaffected). `card` is
  deliberately never prefilled even when the LLM guesses an owner - the
  guess only narrows which cards `Voice.jsx` offers in the dropdown, the
  person always picks explicitly, same as any manual add.
- New `pages/Voice.jsx` - tap-to-record using `MediaRecorder`, mime type
  feature-detected via `isTypeSupported()` (webm preferred, mp4 fallback for
  iOS Safari, which can't record webm - the detail that makes this actually
  work in an installed iPhone PWA). On stop: uploads to `/api/voice/
  capture/`, shows the transcript, then renders `AddTransactionForm`
  prefilled from the draft. New `.voice-record-button` CSS (large circular
  button, red pulsing `recording` state via a new `@keyframes voice-
  recording-pulse`).
- **Found and fixed a real timing bug during verification**: the first
  Ollama call used a 30s timeout, but CPU-only phi3 inference measured
  ~19-20s *after* the model was already warm in memory - a cold request
  (model still loading) blew past 30s and silently fell back to an
  all-null draft (caught by the broad exception handler, so it looked like
  a successful-but-empty response, not an error). Raised to 90s. Confirmed
  fixed by re-running the exact same request after the model was warm:
  correct `amount`/`merchant`/`category`/`owner`/`notes` all resolved.

**Local dev infra**: `docker-compose.yml` gained an `ollama` service
(`ollama/ollama:latest`, named volume, no host port - only `backend` reaches
it internally) and `backend` gained `OLLAMA_URL`/`OLLAMA_MODEL`/
`WHISPER_MODEL` env defaults plus a `whisper_cache` volume so the Whisper
model persists across container recreates. `requirements.txt` gained
`faster-whisper`, `requests`, and (for the prod deploy below) `gunicorn`/
`whitenoise`. The one-time `docker compose exec ollama ollama pull phi3` is
a manual step, not automated (matches "no over-engineering" - it runs once).

**Verified end-to-end** with a throwaway account/card/category/MerchantRule
(deleted after, confirmed real data - 8 cards, 27 categories, 41
transactions - unaffected throughout): a synthetic speech clip
("Twelve dollars at Starbucks for coffee", generated via `espeak-ng` since
no real mic input is possible in this environment) transcribed correctly via
real HTTP/curl, correctly matched an existing `starbucks` MerchantRule
(taking priority over the LLM's own category guess), and committed
correctly as a real `source="voice"` transaction via the existing `POST
/api/transactions/`. Separately, since real speech can't be recorded
headlessly, the *frontend* wiring was verified via headless Playwright with
Chromium's fake-media-device flags (a real `MediaRecorder` start/stop cycle
runs against a fake audio stream; only the `/api/voice/capture/` network
response was mocked, since the real backend pipeline was already verified
via curl) - confirmed the record button/pulsing-recording state/draft
rendering/prefilled form/card-left-blank/submit/confirmation all work,
including at 375px width in dark mode (screenshots reviewed). Also directly
verified `TransactionCreateSerializer`'s new `source` field: `"import"` is
rejected with a validation error, omitting `source` still defaults to
`"manual"` (existing call sites unaffected). `npm run build`/`npm run lint`
and `python manage.py check` clean throughout.

**Oracle Cloud deploy prep** (not yet run against the real instance - the
user runs deploy commands themselves; see the runbook given to them
directly, not committed to the repo): new `docker-compose.prod.yml`
(Postgres with no host port exposed, `backend` via gunicorn instead of
runserver, the same `ollama` service, a one-shot `frontend-build` service
that `npm run build`s and writes `dist/` into a shared volume, and `caddy`
for TLS + reverse-proxy + static serving - one extra container instead of a
separate nginx+certbot setup), `Caddyfile` (validated via `caddy validate`),
`frontend/Dockerfile.prod` (multi-stage build, verified builds clean
locally), and `.env.prod.example` documenting every required var
(`.env.prod` itself is gitignored). `settings.py` gained `whitenoise`
middleware + `STATIC_ROOT`/`STORAGES` so `/admin/` renders correctly once
`DEBUG=false` (a no-op locally, since dev's `runserver` never runs
`collectstatic`). Postgres starts fresh on Oracle per the user's choice - no
data migration from local dev. **Known open risk, can't be tested from this
x86 environment**: `faster-whisper`'s dependencies (`ctranslate2`, `av`)
need aarch64 wheels for the ARM Ampere A1 instance - the backend image built
and ran cleanly on x86 here, but the first real `docker compose -f
docker-compose.prod.yml build` on the actual Oracle box is the first true
test of that; if a wheel is missing, the fix is pinning to whichever
`ctranslate2` version last published `manylinux2014_aarch64` wheels, or
falling back to a slower from-source build.

#### Voice: full-field extraction (item/store/card, not just merchant) + name-recognition bias — 2026-08-25

User's real-world use had two gaps: (1) Whisper sometimes mishears "Soroush"/
"Shiva" and card issuer names since they're not common English words, and
(2) the parsed draft only ever filled `description` (from a single
`merchant` field) and `category`/`owner` - it never separated "what was
bought" from "where", and never attempted to identify *which specific card*
was used, even though people naturally say things like "paid with Soroush's
Amex card."

**Whisper name bias** (`transcribe_audio()`, `services.py`): added
`initial_prompt` (a new `_voice_vocabulary_hint()` helper) - a
comma-separated list of this household's actual proper nouns (both
usernames, capitalized, plus every real Card name), built fresh from the DB
each call rather than hardcoded, so it stays correct across a username
change or a newly-added card. `initial_prompt` conditions Whisper's decoder
toward this vocabulary without forcing it verbatim - doesn't guarantee
correct transcription, but measurably nudges ambiguous audio toward the
household's own words instead of a phonetically-similar generic word.

**Richer field extraction** (`parse_voice_transcript()`, same file): the
Ollama prompt now asks for `description` (the item itself, e.g. "cookies")
and `location` (the store/merchant, e.g. "Walmart") as two separate keys
instead of one `merchant` field, plus a new `card` key (a short phrase like
"Amex" or "UHFCU debit") - explicitly instructed not to guess `owner` or
`card` unless that person/card was actually named in the transcript (added
after testing showed the model would otherwise infer an owner from
context - e.g. "paid with my UHFCU debit card" defaulting to Soroush with
no real basis - a bad-guess risk instead of a "leave nothing filled in"
draft, wrong in the same way Key principle 1 warns against). Category
resolution now checks `location` first via `categorize_by_merchant` (rules
are taught against merchant text), falling back to `description`, then the
LLM's own category guess.

New `resolve_card(card_guess, owner)` matches the free-text `card` guess
against the resolved owner's real `Card` rows (or all cards if owner wasn't
resolved) by word overlap against the card name, with "credit"/"debit"
wording as a secondary tie-breaking signal rather than an equal-weight one
(an earlier version double-counted "credit" as both a name-word and a type
match, which made "Amex credit" tie against "UHFCU - Credit" and resolve to
nothing - fixed by excluding credit/debit from the name-overlap score and
scoring name-word overlap higher). Only returns a card when exactly one is
the unambiguous best match - same never-guess-when-ambiguous principle as
category/owner resolution, so a bare "UHFCU" with no credit/debit qualifier
correctly stays unresolved (the owner has two UHFCU cards) rather than
picking one at random.

`AddTransactionForm.jsx` now accepts `initialValues.location` and
`initialValues.cardId` (previously only description/amount/category/notes
were prefillable, and card was explicitly never prefilled - see the removed
comment to that effect). `Voice.jsx` passes both through from the draft.

Verified end-to-end against real data (2 users, 8 cards, 27 categories, 41
transactions - all confirmed unaffected afterward) via the real backend +
real Ollama (phi3, warmed up first - cold model load on this box took
several minutes and blew past the 90s timeout twice before warming, not a
bug, matches the known cold-start behavior from the 2026-08-19 note, just
slower on this box than the one that note was written on):
- `resolve_card()` unit-tested directly against the real 8 cards for
  ambiguous/unambiguous/wrong-owner cases (documented the "Amex credit" tie
  bug and its fix above).
- `parse_voice_transcript()` run against several real transcripts
  (`"20 dollars for cookies from walmart, paid with Soroush Amex card"` and
  three more varied phrasings) - each correctly split amount/description/
  location, and correctly resolved owner + the exact right card only when a
  person/card was actually named, leaving both null otherwise (confirmed
  after the prompt tightening above).
- Full HTTP round-trip via curl (login as a throwaway user, real
  `multipart/form-data` upload) against a synthetic speech clip
  (`espeak-ng`, since real mic input isn't possible in this environment) -
  confirmed `/api/voice/capture/` returns the new `location`/`card_id`/
  `card_name` fields correctly over real HTTP, not just via the Python
  function directly.
- `transcribe_audio()` with the new `initial_prompt` run directly against
  the same synthetic clip - transcribed "Soroush" correctly; couldn't be a
  true bias A/B test since TTS pronunciation isn't representative of a real
  mishearing case, but confirms the mechanism runs correctly end-to-end
  with no regression to plain transcription.
`python manage.py check`, `npm run build`, `npm run lint` all clean. All
test data (throwaway user, temp audio files) cleaned up afterward.

#### Overview: hide category-scoped cards when a single category is selected — 2026-08-25

User noticed that filtering Overview to one category still showed "By
category" (a breakdown across all categories - meaningless when already
narrowed to one), "Budget vs actual" (a multi-category comparison), and
"Income vs spending" (comparing income against only-that-category spending,
which isn't a meaningful "spending" figure). Added `isCategoryFiltered =
categoryId !== ''` (`Overview.jsx`) - true for a real category id *or* the
"Uncategorized" sentinel value, since both narrow to a single bucket - and
gated all three cards on `!isCategoryFiltered` alongside their existing
conditions (`!isCashInOnly`, `isMonthlyPeriod` where applicable). Also
skipped the Income vs spending card's income fetch entirely when
category-filtered (previously only gated on `isMonthlyPeriod`), so the now
always-hidden card doesn't still fire a wasted API call. "Total spent",
"Transactions", "By person", and "Spend trend" are unaffected - all still
make sense scoped to one category.

Verified via headless Playwright against a throwaway user/card/category/
transaction (deleted afterward, confirmed real data - 2 users, 8 cards, 27
categories, 41 transactions - unaffected): default "All categories" view
shows all 7 cards; selecting the test category correctly leaves exactly 4
("Total spent", "Transactions", "By person", "Spend trend") and hides the
other 3. Screenshot reviewed. `npm run build`/`npm run lint` clean.

#### Real data incident + automated Oracle backups — 2026-08-25, right after

**Incident**: while cleaning up disk space in the Codespace (Ollama/Whisper
were eating ~15GB), `docker compose down -v` was run intending to remove
just the two Ollama-related volumes - the `-v` flag actually removes *every*
volume declared in `docker-compose.yml`, including `jiring_postgres_data`,
which held the real local household database (both real accounts, 8 cards,
27 categories, 41 transactions, 6 income entries, all learned
`MerchantRule`s/`ColumnMapping`s). Confirmed unrecoverable - no leftover
volume directory on disk, no `.sql`/dump backup anywhere in the environment,
nothing in bash history. The user confirmed the separately-deployed Oracle
Cloud instance (a different machine, never touched by anything local) still
has its own real data intact, so the practical damage was: local dev's
database, which the user had also been maintaining by hand in parallel,
had to be rebuilt from scratch (schema via `python manage.py migrate` -
clean, since migrations are in git; login accounts recreated by the user
via `create_household_users`, real household data not reconstructed
locally since Oracle is now the actual day-to-day copy).

**Root cause takeaway, worth remembering**: `docker compose down -v` is
effectively "delete all data for every service in this compose file," not
"stop everything." Removing a specific volume should always be
`docker volume rm <name>` for exactly the volumes intended, never `down -v`
as a shortcut, whenever any volume in the file might hold real data.

**Follow-up the user asked for**: automated backups for the Oracle Postgres
database, since it was now confirmed to be the sole copy of the real
household data with zero backup. Built:
- **`scripts/backup_db.sh`** - dumps the prod DB (`docker compose -f
  docker-compose.prod.yml exec -T db pg_dump -U "$POSTGRES_USER" --clean
  --if-exists "$POSTGRES_DB"`, gzipped) to a timestamped file in
  `~/jiring-backups` on the Oracle box's own disk (outside the git working
  tree entirely, not just gitignored, so there's no path by which real
  financial data could ever end up staged for a commit) - `--clean
  --if-exists` means the dump includes `DROP TABLE IF EXISTS` first, so
  restoring is safe against a non-empty target too, not just a freshly
  migrated one. Prunes local dumps past `BACKUP_RETENTION_DAYS` (default
  30) via `find -mtime`. Run with `--upload` (meant for a weekly cron
  entry), it also PUTs that same dump to Oracle Object Storage via a
  **Pre-Authenticated Request URL** (`BACKUP_PAR_URL` in `.env.prod`, see
  `.env.prod.example`) - deliberately chosen over the OCI CLI to avoid
  installing/configuring an extra tool and managing API key files on the
  box: a PAR is just a plain `curl -X PUT` against a secret URL, and a
  *write-only* PAR (Access Type "Permit object writes") can add backups but
  can't list, read, or delete existing ones, so even a leaked URL couldn't
  expose or wipe past backups. Both cron lines documented in the script's
  own header (daily local-only at 3am, weekly `--upload` on Sundays covers
  both in one run) - installing the actual crontab entries is a one-time
  step the user runs on the Oracle box themselves, since this environment
  has no SSH access to it.
- **`scripts/restore_db.sh`** - the inverse: `gunzip -c <dump> | docker
  compose -f docker-compose.prod.yml exec -T db psql -U "$POSTGRES_USER"
  "$POSTGRES_DB"`. Prompts for a typed "yes" confirmation before running
  (skippable with `--yes` for scripted use) since it's destructive by
  design - a restore is meant to replace whatever's currently there.
- Data volume sized checked directly rather than assumed: a real dump of
  the (much larger, real) local household DB schema came to 8KB gzipped
  even mid-session with test data in it - confirms the user's own instinct
  that retention/space was a non-issue at this app's real scale, even
  keeping daily local copies for a year (worth noting since the user
  originally proposed weekly-only "to save space" - talked through it and
  landed on daily-local + weekly-off-box instead, at effectively zero
  storage cost).

Verified the actual mechanics end-to-end against the local dev database
(not prod - no SSH access to the Oracle box from this environment; same
`pg_dump`/`psql` commands, just pointed at `docker-compose.yml` instead of
`docker-compose.prod.yml`) with throwaway users: dumped, gzip-integrity
checked, confirmed `--clean --if-exists` really emits `DROP TABLE`
statements (21 of them), then did a real destructive round-trip - added a
second throwaway user after the dump, ran the restore command, and
confirmed the DB reverted to exactly the dump's contents (the second user
gone, the first one back) with zero errors in the psql output. Also
separately verified the retention-pruning `find -mtime` command against a
synthetic 40-day-old file - deleted only the old one, left the fresh dump
and an unrelated log file untouched. All test users/files cleaned up
afterward; real local dev DB is now empty (schema only) as expected post-
incident - the user still needs to run `create_household_users` themselves
for local dev login.

**Not yet done - the user's own next steps on the Oracle box**: `git pull`,
`chmod +x scripts/*.sh`, create the Object Storage bucket + write-only PAR
and add `BACKUP_PAR_URL` to `.env.prod` if they want the off-box upload
enabled, then install the two crontab lines from `scripts/backup_db.sh`'s
header comment. Nothing here runs automatically until that crontab step is
done on the actual box.

#### Voice: explicit spoken category beats a stale MerchantRule; teach rules from location — 2026-08-26

User's real voice notes surfaced two gaps in the field-extraction work from
2026-08-25: (1) saying a category out loud ("category is Gift", "put this
under Groceries") had no special weight - it was blended in as the same
`category` field the LLM could also just guess, and a previously-learned
`MerchantRule` on that merchant was checked *first*, so a stale rule could
silently win over what the user had just said out loud; (2) recategorizing
a manual/voice transaction taught `MerchantRule` from `transaction.
description`, but for a manual/voice entry `description` is the item bought
("cookies"), not the merchant - `location` ("Walmart") is the actual
merchant name and the thing a future voice note would repeat, so the
learned keyword was frequently useless.

**Fix** (`services.py`, `parse_voice_transcript()`): the Ollama prompt now
asks for two separate keys instead of one `category` - `category_stated`
(only filled when the speaker explicitly named a category, in any phrasing:
"category is X", "put this under X", "file this as X", "mark it as X",
"this is X spending" - never guessed) and `category_guess` (the LLM's own
soft contextual guess, e.g. Starbucks → Eating Out, inferred even when
nothing was said explicitly). Resolution order is now: `category_stated` →
`categorize_by_merchant(location)` → `categorize_by_merchant(description)`
→ `category_guess` - i.e. an explicit spoken category is treated as the
user overriding/confirming right now and beats a learned rule, but absent
that, a learned rule still beats the LLM's own soft guess (unchanged from
before). `TransactionCreateSerializer.create()` and
`TransactionViewSet.recategorize()` (`serializers.py`/`views.py`) both now
teach `MerchantRule` from `transaction.location or transaction.description`
instead of `description` alone, matching how rules actually get matched
against future imports/voice notes.

Verified with mocked Ollama responses against a throwaway user/cards/
categories/MerchantRule (real local DB was already empty going into this -
see the backup-incident note above - so nothing needed cleanup-and-restore,
just teardown after): a stale `target → Electronics` rule was correctly
overridden by a spoken `category_stated: "Gift"`; with no `category_stated`,
the same stale rule correctly still won over a conflicting
`category_guess`; with neither a stated category nor a matching rule,
`category_guess` was correctly used as the last resort; and
`extract_merchant_keyword()` on a transaction with both `location` and a
different `description` confirmed it now reads from `location`. Also ran
`python manage.py check` and `npm run build` clean (no frontend changes
were needed - `Voice.jsx`/`AddTransactionForm.jsx` already only consume the
resolved `category_id`/`category_name`, unaffected by the stated/guess
split happening entirely server-side). Not yet re-verified against a live
Ollama/phi3 instance with this exact prompt wording after today's session restart
(the 2026-08-25 commit that introduced this prompt was checked against a
live phi3 before landing); worth a quick real-transcript sanity check next
time Ollama is running, but the resolution-priority logic itself - the part
that actually changed today - is fully covered by the mocked-response tests
above.

#### Import: LLM fallback maps unmatched bank categories onto existing categories — 2026-08-27

User's ask: bank exports' own category labels ("Merchandise-Grocery Stores",
"Restaurant-Coffee Shop") rarely match one of our 15 curated categories
exactly, so every mismatch was falling straight to the "(new)" bank-label
suggestion (or uncategorized with no label at all) - even when the row
obviously belongs to a category we already have. Extended the same
LLM-assisted-categorization idea already built for voice (2026-08-26's
`category_stated`/`category_guess` split) to the import pipeline: before
offering a raw bank label as a new-category suggestion, give the self-hosted
Ollama model a shot at mapping the row into one of our EXISTING categories
using every signal the row has (description, amount, bank's own label if
any) - only falling back to the old "(new)"/uncategorized behavior if the
LLM also can't find a confident match.

**`resolve_categories_via_llm(rows)`** (`services.py`) - takes a list of
`{description, amount, category_label}` dicts and returns a same-length list
of `Category`-or-`None`. **Batched into one Ollama call for the whole
list**, not one call per row - a real import can have dozens of new rows,
and a CPU-only call measured ~20s even warm (per the 2026-08-19/08-26 voice
notes), so one-per-row would turn a weekly import into minutes. The prompt
gives the model the full list of existing category names and asks it to
pick one per transaction or `null` if not confident - explicitly told never
to invent a name outside that list. Same fail-closed spirit as
`resolve_card`/`parse_voice_transcript`: any failure (Ollama unreachable,
malformed JSON, a response whose length doesn't match the request, phi3
occasionally wrapping the array in an object - unwrapped defensively rather
than treated as a hard failure) returns all-`None`, never raises, and never
partially trusts a shape it doesn't fully understand.

**Wired into `import_transactions()`'s pending-rows loop**: resolution
order is now MerchantRule match → exact bank-label match (both unchanged,
free/instant, no LLM involved) → **LLM match against existing categories**
(new) → bank label as a "(new)" suggestion, or uncategorized if there's no
label either (unchanged fallback). Only rows that fail the first two checks
get sent to the LLM, and only as one batch after the whole file's rows are
collected - most real imports (recurring merchants already covered by
MerchantRule) trigger zero LLM calls. Each pending row gained
`category_source` (`null` normally, `"ai_match"` when the LLM resolved it) -
`Import.jsx`'s review list shows a small "AI-suggested category... double
check before approving" note under any row flagged that way, since Key
principle 1 (draft-before-commit) means this is still just a prefilled
suggestion in the same editable review step as everything else, not an
auto-commit. No other frontend changes needed - an AI-resolved `category_id`
behaves exactly like a MerchantRule-resolved one in the existing review UI
(pre-selected in the real dropdown, editable/overridable before approving).

**Deliberately left untouched**: the separate duplicate-backfill path (an
already-imported row missing a category getting backfilled from a freshly-
learned rule or newly-mapped category column) still only tries MerchantRule
+ exact label match, no LLM - that path runs synchronously on every import
including routine re-uploads of an already-fully-imported file, and adding
a blocking LLM call there would tax the common case for a rare gap-filling
edge case. Can be extended the same way later if it turns out to matter.

Verified end-to-end via a throwaway user/card/categories with Ollama's
`requests.post` call mocked (no live Ollama instance running in this
environment): (1) a batch of 3 new rows with the model returning confident
matches for 2 and `null` for the third - confirmed the 2 got `category_id`/
`category_name` set to the right existing category with `category_source:
"ai_match"` and no leftover `category_label`, and the third correctly
stayed fully uncategorized (it had no bank label at all, so nothing to
fall back to); (2) the same batch with `requests.post` raising a connection
error - confirmed it falls back cleanly to the pre-existing bank-label-
suggestion/uncategorized behavior with no crash; (3) a row whose bank label
exactly matches an already-existing category - confirmed it resolves
immediately without being included in the LLM batch at all, proving the
free/instant checks still short-circuit before any LLM call. `python
manage.py check`, `npm run build`, `npm run lint` all clean; real data
(currently 0 of everything locally, per the 2026-08-25 incident note - real
data now lives solely on the Oracle deploy) confirmed unaffected throughout.
**Not yet verified against a live Ollama/phi3 instance** - no Ollama
container was running in this environment; the resolution-priority logic
and fail-closed behavior are fully covered by the mocked tests above, but a
real-file sanity check (does phi3 actually pick sensible categories, not
just handle the plumbing correctly) is worth doing next time Ollama is up,
same caveat as the 2026-08-26 voice note.

#### Tags: fixed a silent-drop save bug; Overview gets tag/card filters + an "All time" auto-jump — 2026-09-09

User reported tags couldn't be added/edited at all on the real Oracle deploy,
which cascaded into "can't filter by tags either" (nothing to filter by if
none can ever be saved). Root-caused by reproducing the exact edit flow
against a real backend + real browser (Playwright) rather than guessing: the
backend (`TransactionSerializer`, `TagViewSet`, the `tag` query param) was
completely correct end-to-end - the bug was in `TagEditor`
(`frontend/src/Combobox.jsx`), shared by the Transactions Edit dialog and
`AddTransactionForm`. It only committed a typed tag into the chip list on
Enter/comma; tapping **Save** directly after typing (easy to do, especially
on a phone keyboard) left the text stranded in the input's own `draft`
state, and the save request went through successfully with an empty tag
list - no error anywhere, so it looked exactly like "tags never get added."
**Fix:** `TagEditor`'s input now also commits its draft `onBlur`, with the
standard combobox guard (`onMouseDown` + `preventDefault` on suggestion
buttons) so clicking an autocomplete suggestion still works correctly
instead of the blur firing first and committing the raw typed text. Verified
both paths against a real backend/browser: typing a tag and tapping Save
without pressing Enter now saves it correctly; clicking a suggestion from
the dropdown still adds exactly that tag, no interference.

Separately hardened `frontend/vite.config.js` with `strictPort: true` - while
investigating, a stray leftover dev-server process in the Codespace had
forced a fresh `npm run dev` onto the wrong port, which silently breaks
every PATCH/POST via a CSRF origin mismatch (GETs still work fine, since the
session cookie is unaffected) since `settings.py`'s CORS/CSRF trusted-origin
list is hardcoded to port 5173. Not the actual bug the user hit (that was
confirmed to be live on Oracle, not this Codespace), but a real footgun this
exposed - `strictPort` makes vite fail loudly instead of silently drifting
to another port.

Once tags worked, added the requested Overview filtering to match
Transactions:
- **Tag filter** - same `useTags`/tag-id `<select>` pattern as Transactions,
  wired into `api.transactions.list({ tag: tagId, ... })`. Selecting a tag
  narrows every card the same way the existing category/amount filters do.
- **Card filter** - same `useCards`/card-id `<select>` pattern as
  Transactions, so spending can be viewed per-card (and per-category within
  that card, via the existing "By category" list) - the user's literal ask.
- Both **"Budget vs actual" and "Income vs spending" now also hide** when a
  tag or card filter is active, joining the existing `isCategoryFiltered`/
  `isAmountFiltered` gates - a single tag or a single card is an arbitrary
  slice that cuts across categories (a category's real monthly budget is
  meant to be judged against spending on every card, not just one), so those
  two comparisons don't mean anything scoped that narrowly. "By category" and
  "Spend trend" stay visible under both filters, same as under the amount
  filter.
- **New "All time" date-range option** (`dateFilters.js`/`DateFilter.jsx`,
  shared by Overview and Transactions) - a fixed 2000-01-01-to-today range,
  since this app has no real "since forever" concept otherwise. On Overview
  specifically, **selecting a tag jumps the date filter to All time**
  automatically (a `useEffect` keyed on `tagId` alone, so it only fires when
  the tag selection itself changes, not on every render) - the reasoning
  being a tag like a trip name could span any date range, so defaulting to
  the currently-selected range (often Month to date) would silently hide
  most of what the tag actually covers. The user can freely switch the date
  range again afterward without it snapping back; switching to a *different*
  tag re-triggers the jump (that tag could span different dates too);
  clearing the tag filter doesn't force any date change.

Verified all of the above end-to-end against a real backend + real browser
with throwaway local-dev data (this Codespace's local DB has been empty
since the 2026-08-25 incident - real household data lives solely on Oracle):
tag filter narrowing total spent/transaction count/category breakdown
correctly; card filter narrowing the same way, confirmed with a synthetic
second card; the All-time auto-jump firing on tag select, sticking after a
manual override, re-firing on a different tag, and not firing on clear, all
confirmed via direct `select.input_value()` reads at each step; Budget vs
actual/Income vs spending confirmed hidden under both new filters. `npm run
build`/`npm run lint` clean throughout.

#### Import: flag duplicates of manual/voice entries — 2026-09-09, right after

User's ask: if a transaction was already logged by hand or by voice before
its statement arrives, the eventual bulk import of that same real-world
purchase needs to be caught too - the existing exact dedupe key (owner,
card, date, description, amount) can't catch it, since a hand-typed/spoken
description ("cookies") won't match the bank's own wording ("WALMART
SUPERCENTER #1234"). Requested match signals: card, amount, date, category.

Implemented in `import_transactions()` (`services.py`), as an additional
pass over the pending-rows batch, run *after* category resolution (including
the LLM fallback) so it compares against each row's final resolved category,
not an intermediate guess: for every genuinely-new row (already past the
exact-key dedupe check), look up existing `source="manual"`/`"voice"`
transactions sharing the same card, date, amount, and category (including
both being uncategorized/`None`) - one batched query per import, not one per
row. A match sets `possible_duplicate` on the pending row (matched
transaction's id/description/date/amount/source). Deliberately only checked
against manual/voice source, never against other import rows (those already
dedupe via the exact key).

`Import.jsx`'s review step (same "editable draft, explicit approve before
commit" screen as the bank-label-category review) now shows a flagged row's
warning inline - *"Possible duplicate of a manual entry: '\<description>' for
$X on \<date> - same card, date, amount, and category. Already recorded
there?"* - with a **Remove / Approve anyway** toggle (`.user-toggle`, same
component as the Login screen's person picker), defaulting to **Remove**
per Key principle 1 (never silently auto-commit) - creating a false
duplicate transaction is worse than requiring one extra tap to keep a
genuine coincidence. The "Approve & import N" button's count reflects
exactly what will be sent - flagged-and-left-as-Remove rows are filtered out
client-side before `POST /api/import/confirm/`, no backend change needed
for that half.

Verified end-to-end with throwaway local-dev data: (1) direct
`import_transactions()` call - a manual "cookies" entry ($25, Groceries,
9/10) correctly flagged an incoming "WALMART SUPERCENTER" row (same
date/amount, resolved to Groceries via a test MerchantRule) as a possible
duplicate, while an unrelated $99 row on a different date stayed unflagged;
(2) full browser round-trip via Playwright - review screen rendered the
warning + toggle correctly (screenshot reviewed), default state excluded the
flagged row (button read "Approve & import 1"), clicking "Approve anyway"
correctly bumped it to "Approve & import 2", and the final commit created
both the flagged row (as a real `source="import"` transaction) and the
unrelated row, leaving the original manual entry untouched - confirmed via
the ORM. All test data cleaned up afterward. `npm run build`/`npm run lint`
and `python manage.py check` clean throughout.

### Phase 2 — Voice capture
- [x] `MediaRecorder` audio capture in the PWA
- [x] Upload endpoint + self-hosted Whisper/`faster-whisper` for transcription
- [x] Show raw transcript in-app - done as part of the same round as Phase 3
      below rather than as a separate no-parsing-yet checkpoint (see the
      2026-08-19 status note) - the transcript is always shown regardless of
      whether Ollama's parse succeeds.

### Phase 3 — LLM parsing
- [x] Ollama running Phi-3 Mini (local dev, and pullable the same way on the
      Oracle deploy - try Llama 3.1 8B if extraction accuracy is poor)
- [x] Prompt to extract {amount, merchant, category, owner} as structured JSON
      from a transcript
- [x] One-tap confirm UI before committing to Transaction - built by reusing
      `AddTransactionForm` (prefilled from the parse) rather than a new
      VoiceDraft model/UI - see the Data model section above and the
      2026-08-19 status note.
- [ ] Both of us actually using voice capture day-to-day - built and verified
      this session (transcription, LLM parsing, category/owner resolution,
      commit-as-voice-transaction), but not yet tried against a real phone
      mic or real speech.

## Explicitly out of scope (for now)

- Multi-tenancy / support for more than two users
- Native iOS app (Swift) or React Native
- Third-party auth (OAuth, magic links, etc.)
- Hosted/paid LLM APIs — self-hosted only, by design
- Automated bank sync (Plaid, etc.) — manual weekly export/upload is intentional
