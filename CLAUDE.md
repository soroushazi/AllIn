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
  card's mapping has a category_column - the export's own category label
  as-is (get-or-create by exact name, case-insensitive), else null. So an
  export with its own category column effectively never leaves a transaction
  uncategorized; it's just not necessarily one of *our* curated categories
  yet. Manually recategorizing one (Transactions screen) both fixes it and
  teaches a MerchantRule, so future imports of the same merchant go straight
  to the real category and skip the placeholder entirely.
- **ColumnMapping** — per (owner, card): which spreadsheet columns map to date/
  description/amount, debit/credit split, or the export's own category column
  (optional), plus a sign-flip flag. Learned once per card (via the Import
  screen's first-upload flow), reused on every future upload for that card.
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

1. **Draft-before-commit for anything LLM/voice-parsed.** Parsed transactions from
   voice input are always shown as an editable draft requiring explicit confirmation
   before they hit the real ledger. Never silently auto-commit parsed data.
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

Key frontend files: `frontend/src/api.js` (API client), `AuthContext.jsx`,
`App.jsx` + `Layout.jsx` (routing/shell), `AccountMenu.jsx` (account
dropdown), `icons.jsx` (inline SVG icons), `pages/*.jsx` (the nine screens),
`index.css` (all styling, light/dark via `prefers-color-scheme`),
`vite.config.js` (dev server + `/api` proxy).
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
