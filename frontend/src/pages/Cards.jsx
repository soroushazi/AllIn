import { useEffect, useState } from 'react'
import { api } from '../api'
import { useCards, useUsers } from '../hooks'
import ConfirmDialog from '../ConfirmDialog'

const EMPTY_FORM = { owner: '', name: '', type: 'debit', header_row: '1' }

function baseDraft(card) {
  return { owner: card.owner, name: card.name, type: card.type, header_row: String(card.header_row ?? 1) }
}

export default function Cards() {
  const [cards, setCards] = useCards()
  const [users] = useUsers()
  const [newForm, setNewForm] = useState(EMPTY_FORM)
  const [drafts, setDrafts] = useState({})
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  useEffect(() => {
    if (users.length > 0 && !newForm.owner) setNewForm((f) => ({ ...f, owner: users[0].username }))
  }, [users, newForm.owner])

  function updateDraft(card, patch) {
    setDrafts((d) => ({ ...d, [card.id]: { ...(d[card.id] ?? baseDraft(card)), ...patch } }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newForm.name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const created = await api.cards.create({ ...newForm, name: newForm.name.trim() })
      setCards((cs) => [...cs, created])
      setNewForm({ ...EMPTY_FORM, owner: users[0]?.username || '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleSave(card) {
    const draft = drafts[card.id] ?? baseDraft(card)
    if (!draft.name.trim()) return
    setSavingId(card.id)
    setError(null)
    try {
      const updated = await api.cards.update(card.id, { ...draft, name: draft.name.trim() })
      setCards((cs) => cs.map((c) => (c.id === card.id ? updated : c)))
      setDrafts((d) => {
        const next = { ...d }
        delete next[card.id]
        return next
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  async function confirmDelete() {
    const card = pendingDelete
    setPendingDelete(null)
    setError(null)
    try {
      await api.cards.remove(card.id)
      setCards((cs) => cs.filter((c) => c.id !== card.id))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="stack">
      <h2>Cards</h2>

      <form className="card stack" onSubmit={handleCreate}>
        <h3>New card</h3>
        <div className="filter-row">
          <select value={newForm.owner} onChange={(e) => setNewForm({ ...newForm, owner: e.target.value })}>
            {users.map((u) => (
              <option key={u.id} value={u.username}>
                {u.username[0].toUpperCase() + u.username.slice(1)}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Name (e.g. UHFCU Credit)"
            value={newForm.name}
            onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
            required
          />
          <select value={newForm.type} onChange={(e) => setNewForm({ ...newForm, type: e.target.value })}>
            <option value="debit">Debit</option>
            <option value="credit">Credit</option>
          </select>
        </div>

        <details>
          <summary className="muted small">More information</summary>
          <label>
            Header row
            <input
              type="number"
              min="1"
              value={newForm.header_row}
              onChange={(e) => setNewForm({ ...newForm, header_row: e.target.value })}
            />
          </label>
          <p className="muted small">
            Which row has the column names in this card's export. Almost always 1 - Amex is 7, Discover is 13.
          </p>
        </details>

        <button type="submit" className="primary" disabled={creating || !newForm.name.trim()}>
          {creating ? 'Adding...' : 'Add card'}
        </button>
      </form>

      {error && <div className="error-text">{error}</div>}

      <ul className="category-list">
        {cards.map((card) => {
          const draft = drafts[card.id] ?? baseDraft(card)
          return (
            <li key={card.id} className="category-row card stack">
              <div className="filter-row">
                <select value={draft.owner} onChange={(e) => updateDraft(card, { owner: e.target.value })}>
                  {users.map((u) => (
                    <option key={u.id} value={u.username}>
                      {u.username[0].toUpperCase() + u.username.slice(1)}
                    </option>
                  ))}
                </select>
                <input type="text" value={draft.name} onChange={(e) => updateDraft(card, { name: e.target.value })} />
                <select value={draft.type} onChange={(e) => updateDraft(card, { type: e.target.value })}>
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </div>

              <details>
                <summary className="muted small">More information</summary>
                <label>
                  Header row
                  <input
                    type="number"
                    min="1"
                    value={draft.header_row}
                    onChange={(e) => updateDraft(card, { header_row: e.target.value })}
                  />
                </label>
              </details>
              <div className="transaction-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={savingId === card.id || !draft.name.trim()}
                  onClick={() => handleSave(card)}
                >
                  {savingId === card.id ? 'Saving...' : 'Save'}
                </button>
                <button type="button" className="link-button danger" onClick={() => setPendingDelete(card)}>
                  Delete
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete card?"
        message={
          pendingDelete &&
          `"${pendingDelete.name}" and every transaction imported on it will be permanently deleted - not just uncategorized.`
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
