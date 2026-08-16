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
  no signal; see below), source ("import" or "voice"), dedupe_key. Import
  resolves `category` as: an existing MerchantRule match first, else - if the
  card's mapping has a category_column - the export's own category label as a
  suggestion. New (non-duplicate) rows are never written straight to the
  ledger with that suggestion, though: they're held as an in-memory,
  unpersisted preview (`pending_transactions`) for the user to review/edit
  (description and category, per-row) and explicitly approve via
  `POST /api/import/confirm/` before anything is created - see the
  2026-08-16 "Import: review-before-commit" status note below. Only at that
  approval step does an accepted bank label actually get-or-created as a real
  Category (case-insensitive exact match). Manually recategorizing a
  transaction later (Transactions screen) both fixes it and teaches a
  MerchantRule, so future imports of the same merchant pre-fill the real
  category during review and skip needing a bank-label suggestion entirely.
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
- **VoiceDraft** (phase 2) — parsed-but-unconfirmed transaction awaiting one-tap
  confirmation. Never auto-commits into Transaction.

## Key principles

1. **Draft-before-commit for anything LLM/voice-parsed, or bank-label-categorized.**
   Parsed transactions from voice input, and newly-imported transactions whose
   category comes from a bank's own export label, are always shown as an
   editable draft requiring explicit confirmation before they hit the real
   ledger. Never silently auto-commit parsed data or bank-supplied categories.
2. **Dedup on import.** Re-uploading a file with overlapping dates must not create
   duplicate transactions. Use a dedupe key of (owner, card, date, description,
   amount).
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

Key frontend files: `frontend/src/api.js` (API client), `AuthContext.jsx`,
`App.jsx` + `Layout.jsx` (routing/shell), `AccountMenu.jsx` (account
dropdown), `icons.jsx` (inline SVG icons), `DateFilter.jsx` +
`dateFilters.js` (shared date-range filter, used by Overview and
Transactions), `pages/*.jsx` (the nine screens, incl. the import-review
step in `Import.jsx`), `index.css` (all styling, light/dark via
`prefers-color-scheme`), `vite.config.js` (dev server + `/api` proxy).
Key backend files: `backend/expenses/{models,views,serializers,services,auth,urls}.py`,
`backend/config/settings.py` (CORS/CSRF/ALLOWED_HOSTS, incl. Codespaces auto-detect).

### Phase 2 — Voice capture
- [ ] `MediaRecorder` audio capture in the PWA
- [ ] Upload endpoint + self-hosted Whisper/`faster-whisper` for transcription
- [ ] Show raw transcript in-app (no parsing yet) to validate STT quality

### Phase 3 — LLM parsing
- [ ] Ollama running Phi-3 Mini (try Llama 3.1 8B if extraction accuracy is poor)
- [ ] Prompt to extract {amount, merchant, category, owner} as structured JSON
      from a transcript
- [ ] VoiceDraft model + one-tap confirm UI before committing to Transaction

## Explicitly out of scope (for now)

- Multi-tenancy / support for more than two users
- Native iOS app (Swift) or React Native
- Third-party auth (OAuth, magic links, etc.)
- Hosted/paid LLM APIs — self-hosted only, by design
- Automated bank sync (Plaid, etc.) — manual weekly export/upload is intentional
