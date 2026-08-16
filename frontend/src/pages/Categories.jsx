import { useState } from 'react'
import { api } from '../api'
import { useCategories } from '../hooks'
import ConfirmDialog from '../ConfirmDialog'

const EMPTY_FORM = { name: '', color: '#2a78d6', weekly_budget: '', monthly_budget: '' }

function baseDraft(cat) {
  return {
    name: cat.name,
    color: cat.color,
    weekly_budget: cat.weekly_budget ?? '',
    monthly_budget: cat.monthly_budget ?? '',
  }
}

function toPayload(form) {
  return {
    name: form.name.trim(),
    color: form.color,
    weekly_budget: form.weekly_budget === '' ? null : form.weekly_budget,
    monthly_budget: form.monthly_budget === '' ? null : form.monthly_budget,
  }
}

export default function Categories() {
  const [categories, setCategories] = useCategories()
  const [newForm, setNewForm] = useState(EMPTY_FORM)
  const [drafts, setDrafts] = useState({})
  const [error, setError] = useState(null)
  const [creating, setCreating] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  function updateDraft(cat, patch) {
    setDrafts((d) => ({ ...d, [cat.id]: { ...(d[cat.id] ?? baseDraft(cat)), ...patch } }))
  }

  async function handleCreate(e) {
    e.preventDefault()
    if (!newForm.name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const created = await api.categories.create(toPayload(newForm))
      setCategories((cs) => [...cs, created].sort((a, b) => a.name.localeCompare(b.name)))
      setNewForm(EMPTY_FORM)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  async function handleSave(cat) {
    const draft = drafts[cat.id] ?? baseDraft(cat)
    if (!draft.name.trim()) return
    setSavingId(cat.id)
    setError(null)
    try {
      const updated = await api.categories.update(cat.id, toPayload(draft))
      setCategories((cs) => cs.map((c) => (c.id === cat.id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name)))
      setDrafts((d) => {
        const next = { ...d }
        delete next[cat.id]
        return next
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  async function confirmDelete() {
    const cat = pendingDelete
    setPendingDelete(null)
    setError(null)
    try {
      await api.categories.remove(cat.id)
      setCategories((cs) => cs.filter((c) => c.id !== cat.id))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="stack">
      <h2>Categories</h2>

      <form className="card stack" onSubmit={handleCreate}>
        <h3>New category</h3>
        <div className="filter-row">
          <input
            type="text"
            placeholder="Name"
            value={newForm.name}
            onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
            required
          />
          <input
            type="color"
            value={newForm.color}
            onChange={(e) => setNewForm({ ...newForm, color: e.target.value })}
            title="Color"
          />
        </div>
        <div className="filter-row">
          <label>
            Weekly budget
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="none"
              value={newForm.weekly_budget}
              onChange={(e) => setNewForm({ ...newForm, weekly_budget: e.target.value })}
            />
          </label>
          <label>
            Monthly budget
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="none"
              value={newForm.monthly_budget}
              onChange={(e) => setNewForm({ ...newForm, monthly_budget: e.target.value })}
            />
          </label>
        </div>
        <button type="submit" className="primary" disabled={creating || !newForm.name.trim()}>
          {creating ? 'Adding...' : 'Add category'}
        </button>
      </form>

      {error && <div className="error-text">{error}</div>}

      <ul className="category-list">
        {categories.map((cat) => {
          const draft = drafts[cat.id] ?? baseDraft(cat)
          return (
            <li key={cat.id} className="category-row card stack">
              <div className="filter-row">
                <input type="text" value={draft.name} onChange={(e) => updateDraft(cat, { name: e.target.value })} />
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) => updateDraft(cat, { color: e.target.value })}
                  title="Color"
                />
              </div>
              <div className="filter-row">
                <label>
                  Weekly budget
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="none"
                    value={draft.weekly_budget}
                    onChange={(e) => updateDraft(cat, { weekly_budget: e.target.value })}
                  />
                </label>
                <label>
                  Monthly budget
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="none"
                    value={draft.monthly_budget}
                    onChange={(e) => updateDraft(cat, { monthly_budget: e.target.value })}
                  />
                </label>
              </div>
              <div className="transaction-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={savingId === cat.id || !draft.name.trim()}
                  onClick={() => handleSave(cat)}
                >
                  {savingId === cat.id ? 'Saving...' : 'Save'}
                </button>
                <button type="button" className="link-button danger" onClick={() => setPendingDelete(cat)}>
                  Delete
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete category?"
        message={pendingDelete && `"${pendingDelete.name}" will be removed. Its transactions become uncategorized.`}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
