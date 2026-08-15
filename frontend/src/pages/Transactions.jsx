import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { useCards, useCategories } from '../hooks'

export default function Transactions() {
  const [categories] = useCategories()
  const [cards] = useCards()

  const [owner, setOwner] = useState('')
  const [cardId, setCardId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [search, setSearch] = useState('')

  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.transactions
      .list({ owner, card: cardId, category: categoryId, search })
      .then(setTransactions)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [owner, cardId, categoryId, search])

  useEffect(() => {
    load()
  }, [load])

  async function handleRecategorize(id, newCategoryId) {
    const previous = transactions
    setTransactions((txs) => txs.map((t) => (t.id === id ? { ...t, category: newCategoryId || null } : t)))
    try {
      await api.transactions.recategorize(id, newCategoryId || null)
    } catch (err) {
      setTransactions(previous)
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    const previous = transactions
    setTransactions((txs) => txs.filter((t) => t.id !== id))
    try {
      await api.transactions.remove(id)
    } catch (err) {
      setTransactions(previous)
      setError(err.message)
    }
  }

  const categoryById = Object.fromEntries(categories.map((c) => [c.id, c]))

  return (
    <div className="stack">
      <h2>Transactions</h2>

      <div className="filter-row">
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Everyone</option>
          <option value="soroush">Soroush</option>
          <option value="shiva">Shiva</option>
        </select>

        <select value={cardId} onChange={(e) => setCardId(e.target.value)}>
          <option value="">All cards</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.owner[0].toUpperCase() + c.owner.slice(1)} - {c.name}
            </option>
          ))}
        </select>

        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          <option value="uncategorized">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <input
          type="search"
          placeholder="Search description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && transactions.length === 0 && <p className="muted">No transactions match these filters.</p>}

      <ul className="transaction-list">
        {transactions.map((t) => {
          const category = categoryById[t.category]
          return (
            <li key={t.id} className="transaction-row">
              <div className="transaction-main">
                <span
                  className="category-dot"
                  style={{ background: category ? category.color : 'var(--surface-3)' }}
                />
                <div className="transaction-desc">
                  <div>{t.description}</div>
                  <div className="muted small">
                    {t.date} - {t.owner[0].toUpperCase() + t.owner.slice(1)} - {t.card_name}
                  </div>
                </div>
                <div className={`amount ${Number(t.amount) < 0 ? 'positive' : ''}`}>
                  {Number(t.amount) < 0 ? '+' : ''}
                  {Math.abs(Number(t.amount)).toFixed(2)}
                </div>
              </div>
              <div className="transaction-actions">
                <select
                  value={t.category ?? ''}
                  onChange={(e) => handleRecategorize(t.id, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button className="link-button danger" onClick={() => handleDelete(t.id)}>
                  Delete
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
