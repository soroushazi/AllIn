import { useEffect, useState } from 'react'
import { api } from '../api'
import { useCards, useCategories } from '../hooks'

const EMPTY_MAPPING = {
  date_column: '',
  description_column: '',
  amount_column: '',
  debit_column: '',
  credit_column: '',
  category_column: '',
  type_column: '',
  alt_card: '',
  flip_sign: false,
}

const OWNERS = ['soroush', 'shiva']

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function LogIncome() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ owner: OWNERS[0], date: todayISO(), amount: '', source: 'Paycheck' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.income
      .list()
      .then(setEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.amount) return
    setSubmitting(true)
    setError(null)
    try {
      const created = await api.income.create(form)
      setEntries((prev) => [created, ...prev])
      setForm((f) => ({ ...f, amount: '' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id) {
    const previous = entries
    setEntries((prev) => prev.filter((e) => e.id !== id))
    try {
      await api.income.remove(id)
    } catch (err) {
      setEntries(previous)
      setError(err.message)
    }
  }

  return (
    <div className="stack">
      <form className="card stack" onSubmit={handleSubmit}>
        <div className="filter-row">
          <select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
            {OWNERS.map((o) => (
              <option key={o} value={o}>
                {o[0].toUpperCase() + o.slice(1)}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />
        </div>
        <div className="filter-row">
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Amount"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            required
          />
          <input
            type="text"
            placeholder="Source"
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
          />
        </div>

        {error && <div className="error-text">{error}</div>}

        <button type="submit" className="primary" disabled={submitting || !form.amount}>
          {submitting ? 'Adding...' : 'Add income'}
        </button>
      </form>

      {loading && <p className="muted">Loading...</p>}
      {!loading && entries.length === 0 && <p className="muted">No income logged yet.</p>}

      <ul className="transaction-list">
        {entries.map((entry) => (
          <li key={entry.id} className="transaction-row">
            <div className="transaction-main">
              <div className="transaction-desc">
                <div>{entry.source || 'Income'}</div>
                <div className="muted small">
                  {entry.date} - {entry.owner[0].toUpperCase() + entry.owner.slice(1)}
                </div>
              </div>
              <div className="amount positive">+{Number(entry.amount).toFixed(2)}</div>
            </div>
            <div className="transaction-actions">
              <button className="link-button danger" onClick={() => handleDelete(entry.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function draftFromPendingRow(row) {
  return {
    ...row,
    selectedCategoryId: row.category_id ? String(row.category_id) : row.category_label ? '__new__' : '',
  }
}

function ImportStatement() {
  const [cards] = useCards()
  const [categories] = useCategories()
  const [cardId, setCardId] = useState('')
  const [file, setFile] = useState(null)
  const [remap, setRemap] = useState(false)
  const [amountMode, setAmountMode] = useState('single') // 'single' | 'split'
  const [mapping, setMapping] = useState(EMPTY_MAPPING)
  const [detectedColumns, setDetectedColumns] = useState(null)
  const [pendingTransactions, setPendingTransactions] = useState(null)
  const [previewMeta, setPreviewMeta] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [committing, setCommitting] = useState(false)

  function reset() {
    setFile(null)
    setRemap(false)
    setDetectedColumns(null)
    setMapping(EMPTY_MAPPING)
    setPendingTransactions(null)
    setPreviewMeta(null)
    setResult(null)
    setError(null)
    document.getElementById('import-file-input').value = ''
  }

  async function submitUpload(withMapping) {
    if (!cardId || !file) return
    setSubmitting(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('card', cardId)
      formData.append('file', file)
      if (remap) formData.append('remap', 'true')
      if (withMapping) {
        formData.append('date_column', mapping.date_column)
        formData.append('description_column', mapping.description_column)
        if (amountMode === 'single') {
          formData.append('amount_column', mapping.amount_column)
        } else {
          formData.append('debit_column', mapping.debit_column)
          formData.append('credit_column', mapping.credit_column)
        }
        if (mapping.category_column) formData.append('category_column', mapping.category_column)
        if (mapping.type_column) formData.append('type_column', mapping.type_column)
        if (mapping.alt_card) formData.append('alt_card', mapping.alt_card)
        formData.append('flip_sign', mapping.flip_sign ? 'true' : 'false')
      }

      const data = await api.import(formData)
      if (data.mapping_required) {
        setDetectedColumns(data.detected_columns)
        setMapping({
          ...EMPTY_MAPPING,
          ...data.suggested_mapping,
          alt_card: data.suggested_mapping.alt_card ? String(data.suggested_mapping.alt_card) : '',
        })
        setAmountMode(data.suggested_mapping.amount_column ? 'single' : 'split')
      } else if (data.pending_transactions.length > 0) {
        setPendingTransactions(data.pending_transactions.map(draftFromPendingRow))
        setPreviewMeta(data)
        setDetectedColumns(null)
      } else {
        setResult({ ...data, imported: 0, uncategorized: 0 })
        setDetectedColumns(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  function updateDraftRow(key, patch) {
    setPendingTransactions((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  async function handleApprove() {
    setCommitting(true)
    setError(null)
    try {
      const rows = pendingTransactions.map((r) => {
        const row = {
          date: r.date,
          original_description: r.original_description,
          description: r.description,
          amount: r.amount,
          card_id: r.card_id,
        }
        if (r.selectedCategoryId === '__new__') {
          row.category_label = r.category_label
        } else if (r.selectedCategoryId) {
          row.category_id = r.selectedCategoryId
        }
        return row
      })
      const commitResult = await api.importConfirm(rows)
      setResult({
        ...previewMeta,
        imported: commitResult.imported,
        // Both stages can skip duplicates - preview skips rows already
        // imported before this upload, commit re-checks in case another
        // review session committed the same rows in between. Add them
        // together rather than letting one clobber the other.
        duplicates_skipped: (previewMeta.duplicates_skipped || 0) + commitResult.duplicates_skipped,
        uncategorized: commitResult.uncategorized,
      })
      setPendingTransactions(null)
      setPreviewMeta(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setCommitting(false)
    }
  }

  function handleFirstSubmit(e) {
    e.preventDefault()
    submitUpload(false)
  }

  function handleMappingConfirm(e) {
    e.preventDefault()
    submitUpload(true)
  }

  const selectedCard = cards.find((c) => c.id === Number(cardId))
  const siblingCards = selectedCard ? cards.filter((c) => c.owner === selectedCard.owner && c.id !== selectedCard.id) : []

  return (
    <div className="stack">
      {!detectedColumns && !pendingTransactions && !result && (
        <form className="card stack" onSubmit={handleFirstSubmit}>
          <label>
            Card
            <select value={cardId} onChange={(e) => setCardId(e.target.value)} required>
              <option value="" disabled>
                Select a card...
              </option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.owner[0].toUpperCase() + c.owner.slice(1)} - {c.name} ({c.type})
                </option>
              ))}
            </select>
          </label>

          <label>
            File (.csv, .xls, or .xlsx)
            <input
              id="import-file-input"
              type="file"
              accept=".csv,.xls,.xlsx"
              onChange={(e) => setFile(e.target.files[0] || null)}
              required
            />
          </label>

          <details>
            <summary className="muted small">More information</summary>
            <label className="checkbox-row">
              <input type="checkbox" checked={remap} onChange={(e) => setRemap(e.target.checked)} />
              Re-map columns for this card
            </label>
            <p className="muted small">
              This card already has a saved column mapping and it's normally reused automatically. Check this to
              redo it - e.g. to add a category column that wasn't mapped before.
            </p>
          </details>

          {error && <div className="error-text">{error}</div>}

          <button type="submit" className="primary" disabled={submitting || !cardId || !file}>
            {submitting ? 'Uploading...' : 'Upload'}
          </button>
        </form>
      )}

      {detectedColumns && (
        <form className="card stack" onSubmit={handleMappingConfirm}>
          <p>
            {remap
              ? "Update this card's column mapping - it's remembered for every future upload."
              : "First import for this card - map the columns once and it's remembered for every future upload."}
          </p>
          <p className="muted small">
            Columns look wrong? Check the header row on the Cards screen, then{' '}
            <button type="button" className="link-button" onClick={reset}>
              start over
            </button>
            .
          </p>

          <label>
            Date column
            <select
              value={mapping.date_column}
              onChange={(e) => setMapping({ ...mapping, date_column: e.target.value })}
              required
            >
              <option value="" disabled>
                Select...
              </option>
              {detectedColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label>
            Description column
            <select
              value={mapping.description_column}
              onChange={(e) => setMapping({ ...mapping, description_column: e.target.value })}
              required
            >
              <option value="" disabled>
                Select...
              </option>
              {detectedColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label>
            Category column (optional)
            <select
              value={mapping.category_column}
              onChange={(e) => setMapping({ ...mapping, category_column: e.target.value })}
            >
              <option value="">None</option>
              {detectedColumns.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            If the export has its own category column (e.g. Amex/Discover both call it "Category"), transactions
            are labeled with that category as-is - creating a new category if we don't already have a matching
            one. Clean these up anytime on the Categories or Transactions screens.
          </p>

          <details>
            <summary className="muted small">More information</summary>
            <label>
              Type column (optional)
              <select
                value={mapping.type_column}
                onChange={(e) => setMapping({ ...mapping, type_column: e.target.value })}
              >
                <option value="">None</option>
                {detectedColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            {mapping.type_column && (
              <label>
                Alternate card
                <select value={mapping.alt_card} onChange={(e) => setMapping({ ...mapping, alt_card: e.target.value })}>
                  <option value="">None</option>
                  {siblingCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.type})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="muted small">
              For exports that mix debit and credit transactions in one file for the same person (e.g. UHFCU) -
              map the column that says which is which, then pick the other card here. Each row gets filed under
              whichever of the two it actually belongs to; anything that matches neither is skipped and listed
              for review after import. Leave both blank for a single-account card (e.g. SoFi) - even if its export
              has its own "Type" column (Zelle, Direct deposit, etc.), mapping it here without an alternate card
              has no effect either way.
            </p>
          </details>

          <div className="user-toggle">
            <button type="button" className={amountMode === 'single' ? 'active' : ''} onClick={() => setAmountMode('single')}>
              Single amount column
            </button>
            <button type="button" className={amountMode === 'split' ? 'active' : ''} onClick={() => setAmountMode('split')}>
              Separate debit/credit
            </button>
          </div>

          {amountMode === 'single' ? (
            <label>
              Amount column
              <select
                value={mapping.amount_column}
                onChange={(e) => setMapping({ ...mapping, amount_column: e.target.value })}
                required
              >
                <option value="" disabled>
                  Select...
                </option>
                {detectedColumns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label>
                Debit column
                <select
                  value={mapping.debit_column}
                  onChange={(e) => setMapping({ ...mapping, debit_column: e.target.value })}
                  required
                >
                  <option value="" disabled>
                    Select...
                  </option>
                  {detectedColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Credit column
                <select
                  value={mapping.credit_column}
                  onChange={(e) => setMapping({ ...mapping, credit_column: e.target.value })}
                  required
                >
                  <option value="" disabled>
                    Select...
                  </option>
                  {detectedColumns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={mapping.flip_sign}
              onChange={(e) => setMapping({ ...mapping, flip_sign: e.target.checked })}
            />
            Flip sign (check this if your export shows spending as negative)
          </label>

          {error && <div className="error-text">{error}</div>}

          <button type="submit" className="primary" disabled={submitting}>
            {submitting ? 'Importing...' : 'Save mapping & import'}
          </button>
        </form>
      )}

      {pendingTransactions && (
        <div className="stack">
          <div className="card stack">
            <p>
              <strong>{pendingTransactions.length}</strong> new transaction{pendingTransactions.length === 1 ? '' : 's'}{' '}
              ready to review. Edit the description or category on any row, then approve to add them to the ledger -
              nothing below is saved yet.
            </p>
            <p className="muted small">
              <button type="button" className="link-button" onClick={reset}>
                Discard and start over
              </button>
            </p>
          </div>

          <ul className="category-list">
            {pendingTransactions.map((row) => (
              <li key={row.key} className="category-row card stack">
                <div className="muted small">
                  {row.date} - {row.card_name}
                </div>
                <input
                  type="text"
                  value={row.description}
                  onChange={(e) => updateDraftRow(row.key, { description: e.target.value })}
                />
                <div className="filter-row">
                  <select
                    value={row.selectedCategoryId}
                    onChange={(e) => updateDraftRow(row.key, { selectedCategoryId: e.target.value })}
                  >
                    <option value="">Uncategorized</option>
                    {row.category_label && <option value="__new__">{row.category_label} (new)</option>}
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <div className="amount" style={{ display: 'flex', alignItems: 'center' }}>
                    ${Number(row.amount).toFixed(2)}
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {error && <div className="error-text">{error}</div>}

          <button type="button" className="primary" onClick={handleApprove} disabled={committing}>
            {committing ? 'Importing...' : `Approve & import ${pendingTransactions.length}`}
          </button>
        </div>
      )}

      {result && (
        <div className="card stack">
          <h3>Import complete</h3>
          <ul className="summary-list">
            <li>
              <strong>{result.imported}</strong> transactions imported
            </li>
            <li>
              <strong>{result.duplicates_skipped}</strong> duplicates skipped
              {result.backfilled_categories > 0 && ` (${result.backfilled_categories} backfilled with bank category)`}
            </li>
            <li>
              <strong>{result.unparseable_rows_skipped}</strong> rows skipped (unparseable)
            </li>
            <li>
              <strong>{result.payments_excluded?.length ?? 0}</strong> credit card payments excluded (not spending)
            </li>
            <li>
              <strong>{result.transfers_excluded?.length ?? 0}</strong> transfers between our accounts excluded
            </li>
            {result.income_added?.length > 0 && (
              <li>
                <strong>{result.income_added.length}</strong> added to income
              </li>
            )}
            {result.type_mismatches?.length > 0 && (
              <li>
                <strong>{result.type_mismatches.length}</strong> rows skipped (matched neither card's type)
              </li>
            )}
            <li>
              <strong>{result.uncategorized}</strong> uncategorized
            </li>
          </ul>

          {result.payments_excluded?.length > 0 && (
            <details>
              <summary className="muted small">Review excluded payment rows</summary>
              <ul className="summary-list">
                {result.payments_excluded.map((p, i) => (
                  <li key={i} className="small">
                    {p.date} - {p.description} - {p.amount}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                If any of these were actually real purchases, let us know the wording and we'll tighten the filter.
              </p>
            </details>
          )}

          {result.transfers_excluded?.length > 0 && (
            <details>
              <summary className="muted small">Review excluded transfer rows</summary>
              <ul className="summary-list">
                {result.transfers_excluded.map((p, i) => (
                  <li key={i} className="small">
                    {p.date} - {p.description} - {p.amount}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                If any of these weren't actually a transfer between our own accounts, let us know the wording and
                we'll tighten the filter.
              </p>
            </details>
          )}

          {result.income_added?.length > 0 && (
            <details>
              <summary className="muted small">Review income added</summary>
              <ul className="summary-list">
                {result.income_added.map((p, i) => (
                  <li key={i} className="small">
                    {p.date} - {p.description} - {p.amount}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                Recognized as a paycheck deposit and logged to Income instead of the transaction ledger - check the
                Import screen's "Log income" tab to review or remove it.
              </p>
            </details>
          )}

          {result.type_mismatches?.length > 0 && (
            <details>
              <summary className="muted small">Review skipped rows</summary>
              <ul className="summary-list">
                {result.type_mismatches.map((p, i) => (
                  <li key={i} className="small">
                    {p.date} - {p.description} - {p.amount} - type: {p.type}
                  </li>
                ))}
              </ul>
              <p className="muted small">
                These didn't match this card's type or the alternate card's type - if any of these should have been
                imported, re-check the Type column and alternate card via "Re-map columns for this card" above.
              </p>
            </details>
          )}

          <button className="primary" onClick={reset}>
            Import another file
          </button>
        </div>
      )}
    </div>
  )
}

export default function Import() {
  const [mode, setMode] = useState('statement')

  return (
    <div className="stack">
      <h2>Import</h2>

      <div className="user-toggle">
        <button className={mode === 'statement' ? 'active' : ''} onClick={() => setMode('statement')}>
          Import statement
        </button>
        <button className={mode === 'income' ? 'active' : ''} onClick={() => setMode('income')}>
          Log income
        </button>
      </div>

      {mode === 'statement' ? <ImportStatement /> : <LogIncome />}
    </div>
  )
}
