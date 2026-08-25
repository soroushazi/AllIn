import { useState } from 'react'
import { api } from './api'
import { TagEditor, LocationCombobox } from './Combobox'
import ConfirmDialog from './ConfirmDialog'

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// A single, manually-typed transaction - as opposed to a bulk statement
// upload. Shared between the Import screen's "Add transaction" tab, the form
// at the top of the Transactions screen, and the Voice screen's
// confirm-before-commit draft (initialValues/source - see Voice.jsx).
// initialValues.cardId prefills the card only when the voice draft resolved
// one with confidence (see resolve_card in services.py) - the user can
// always change it, same as every other prefilled field here.
export default function AddTransactionForm({
  cards,
  categories,
  locationSuggestions,
  tagSuggestions,
  onAdded,
  initialValues,
  source = 'manual',
}) {
  const [cardId, setCardId] = useState(initialValues?.cardId || '')
  const [date, setDate] = useState(todayISO())
  const [description, setDescription] = useState(initialValues?.description || '')
  const [direction, setDirection] = useState(initialValues?.direction || 'out')
  const [amount, setAmount] = useState(initialValues?.amount || '')
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId || '')
  const [location, setLocation] = useState(initialValues?.location || '')
  const [notes, setNotes] = useState(initialValues?.notes || '')
  const [tags, setTags] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [pendingDuplicate, setPendingDuplicate] = useState(null) // { payload, similar }

  function addTag(name) {
    const value = name.trim()
    if (!value || tags.some((t) => t.toLowerCase() === value.toLowerCase())) return
    setTags([...tags, value])
  }

  function removeTag(name) {
    setTags(tags.filter((t) => t !== name))
  }

  function afterAdd(created) {
    onAdded(created)
    // Keep card/date/direction so logging several receipts in a row
    // doesn't require re-picking them each time; clear the rest.
    setDescription('')
    setAmount('')
    setCategoryId('')
    setLocation('')
    setNotes('')
    setTags([])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!cardId || !date || !description || !amount) return
    const card = cards.find((c) => c.id === Number(cardId))
    const signedAmount = direction === 'in' ? -Math.abs(Number(amount)) : Math.abs(Number(amount))
    const payload = {
      owner: card.owner,
      card: cardId,
      date,
      description,
      amount: signedAmount.toFixed(2),
      category: categoryId || null,
      notes,
      location,
      tags,
      source,
    }
    setSubmitting(true)
    setError(null)
    try {
      const result = await api.transactions.create(payload)
      if (result.possible_duplicate) {
        // Manual/voice entries have no bank string to dedupe against like
        // import does - same card/date/amount but a different description
        // could be the same purchase typed differently, or a genuinely
        // separate one. Ask instead of silently skipping or silently
        // allowing.
        setPendingDuplicate({ payload, similar: result.similar_transactions })
        return
      }
      afterAdd(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmAddAnyway() {
    const { payload } = pendingDuplicate
    setSubmitting(true)
    setError(null)
    try {
      const created = await api.transactions.create({ ...payload, confirm_duplicate: true })
      setPendingDuplicate(null)
      afterAdd(created)
    } catch (err) {
      setPendingDuplicate(null)
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const duplicateMessage =
    pendingDuplicate &&
    (() => {
      const [first, ...rest] = pendingDuplicate.similar
      const amountStr = Math.abs(Number(first.amount)).toFixed(2)
      return `A similar transaction already exists on ${first.date} for $${amountStr}: "${first.description}"${
        rest.length > 0 ? ` (and ${rest.length} more)` : ''
      }. Add this one anyway?`
    })()

  return (
    <form className="card stack" onSubmit={handleSubmit}>
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

      <div className="filter-row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>

      <div className="user-toggle">
        <button type="button" className={direction === 'out' ? 'active' : ''} onClick={() => setDirection('out')}>
          Cash out
        </button>
        <button type="button" className={direction === 'in' ? 'active' : ''} onClick={() => setDirection('in')}>
          Cash in
        </button>
      </div>

      <div className="filter-row">
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <label>
        Where
        <LocationCombobox value={location} onChange={setLocation} suggestions={locationSuggestions} />
      </label>

      <label>
        Detailed description
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. dining out with Alex, celebrating a promotion"
        />
      </label>

      <label>
        Tags
        <TagEditor tags={tags} suggestions={tagSuggestions} onAdd={addTag} onRemove={removeTag} />
      </label>

      {error && <div className="error-text">{error}</div>}

      <button type="submit" className="primary" disabled={submitting || !cardId || !description || !amount}>
        {submitting ? 'Adding...' : 'Add transaction'}
      </button>

      <ConfirmDialog
        open={!!pendingDuplicate}
        title="Possible duplicate"
        message={duplicateMessage}
        confirmLabel="Add anyway"
        confirmVariant="primary"
        onConfirm={confirmAddAnyway}
        onCancel={() => setPendingDuplicate(null)}
      />
    </form>
  )
}
