import { useEffect, useState } from 'react'
import { api } from '../api'
import { useCards } from '../hooks'

const EMPTY_MAPPING = {
  date_column: '',
  description_column: '',
  amount_column: '',
  debit_column: '',
  credit_column: '',
  category_column: '',
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

function ImportStatement() {
  const [cards] = useCards()
  const [cardId, setCardId] = useState('')
  const [file, setFile] = useState(null)
  const [remap, setRemap] = useState(false)
  const [amountMode, setAmountMode] = useState('single') // 'single' | 'split'
  const [mapping, setMapping] = useState(EMPTY_MAPPING)
  const [detectedColumns, setDetectedColumns] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setFile(null)
    setRemap(false)
    setDetectedColumns(null)
    setMapping(EMPTY_MAPPING)
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
        formData.append('flip_sign', mapping.flip_sign ? 'true' : 'false')
      }

      const data = await api.import(formData)
      if (data.mapping_required) {
        setDetectedColumns(data.detected_columns)
        setMapping({ ...EMPTY_MAPPING, ...data.suggested_mapping })
        setAmountMode(data.suggested_mapping.amount_column ? 'single' : 'split')
      } else {
        setResult(data)
        setDetectedColumns(null)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
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

  return (
    <div className="stack">
      {!detectedColumns && !result && (
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
