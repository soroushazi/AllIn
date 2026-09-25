import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useCards, useCategories, useLocations, useTags, useUsers } from '../hooks'
import DateFilter from '../DateFilter'
import { getDateRange, toISO } from '../dateFilters'
import ConfirmDialog from '../ConfirmDialog'
import AddTransactionForm from '../AddTransactionForm'
import { TagEditor, LocationCombobox } from '../Combobox'

function EditTransactionDialog({ transaction, categories, locationSuggestions, tagSuggestions, onSave, onCancel }) {
  const [category, setCategory] = useState(transaction.category ?? '')
  const [location, setLocation] = useState(transaction.location || '')
  const [notes, setNotes] = useState(transaction.notes || '')
  const [tags, setTags] = useState(transaction.tags)

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function addTag(name) {
    const value = name.trim()
    if (!value || tags.some((t) => t.toLowerCase() === value.toLowerCase())) return
    setTags([...tags, value])
  }

  function removeTag(name) {
    setTags(tags.filter((t) => t !== name))
  }

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-card card stack" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">Edit transaction</h3>
        <p className="dialog-message muted">{transaction.description}</p>

        <label>
          Category
          <select value={category ?? ''} onChange={(e) => setCategory(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Where
          <LocationCombobox value={location} onChange={setLocation} suggestions={locationSuggestions} />
        </label>

        <label>
          Detailed description
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. dining out with Alex, celebrating a promotion"
          />
        </label>

        <label>
          Tags
          <TagEditor tags={tags} suggestions={tagSuggestions} onAdd={addTag} onRemove={removeTag} />
        </label>

        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => onSave({ category: category || null, location, notes, tags })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function BulkEditDialog({ count, categories, tagSuggestions, onSave, onCancel }) {
  // '' = leave each transaction's category as-is, 'none' = uncategorize all,
  // otherwise a category id - same three-state need as the single-edit
  // dialog doesn't have, since that one always shows (and can replace) one
  // real current value; here there usually isn't one shared value across
  // the whole selection.
  const [categoryChoice, setCategoryChoice] = useState('')
  const [addTags, setAddTags] = useState([])

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function addTag(name) {
    const value = name.trim()
    if (!value || addTags.some((t) => t.toLowerCase() === value.toLowerCase())) return
    setAddTags([...addTags, value])
  }

  function removeTag(name) {
    setAddTags(addTags.filter((t) => t !== name))
  }

  const hasChanges = categoryChoice !== '' || addTags.length > 0

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-card card stack" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">Edit {count} transaction{count === 1 ? '' : 's'}</h3>
        <p className="dialog-message muted">
          Only what you change here gets applied - anything left as "Don't change" stays as it was on each
          transaction.
        </p>

        <label>
          Category
          <select value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value)}>
            <option value="">Don't change</option>
            <option value="none">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Add tag
          <TagEditor tags={addTags} suggestions={tagSuggestions} onAdd={addTag} onRemove={removeTag} />
        </label>
        <p className="muted small">Each transaction's existing tags are kept - this only adds new ones.</p>

        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!hasChanges}
            onClick={() =>
              onSave({
                categoryProvided: categoryChoice !== '',
                category: categoryChoice === 'none' ? null : categoryChoice ? Number(categoryChoice) : undefined,
                addTags,
              })
            }
          >
            Apply to {count}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddTransactionDialog({ cards, categories, locationSuggestions, tagSuggestions, onAdded, onClose }) {
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-card card stack" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="dialog-title">Add transaction</h3>
        <AddTransactionForm
          cards={cards}
          categories={categories}
          locationSuggestions={locationSuggestions}
          tagSuggestions={tagSuggestions}
          onAdded={onAdded}
        />
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Transactions() {
  const [categories] = useCategories()
  const [cards] = useCards()
  const [users] = useUsers()
  const [tags, setTags] = useTags()
  const [locations, setLocations] = useLocations()

  const [dateFilter, setDateFilter] = useState('mtd')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [owner, setOwner] = useState('')
  const [cardId, setCardId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [tagId, setTagId] = useState('')
  const [direction, setDirection] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [search, setSearch] = useState('')

  const [transactions, setTransactions] = useState([])
  const [incomes, setIncomes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [pendingIncomeDelete, setPendingIncomeDelete] = useState(null)
  const [editingTransaction, setEditingTransaction] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkEdit, setShowBulkEdit] = useState(false)
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false)

  // Income has no card/category/tag of its own, so it can't meaningfully
  // satisfy a filter on any of those - only fold it into the list when
  // Cash in is involved and none of those three narrow the view. Same
  // reasoning as the equivalent flag on Overview.
  const cashInEligible = (direction === 'in' || direction === '') && !cardId && !categoryId && !tagId

  const [rangeStart, rangeEnd] = useMemo(
    () => getDateRange(dateFilter, customStart, customEnd),
    [dateFilter, customStart, customEnd]
  )

  const load = useCallback(() => {
    setLoading(true)
    api.transactions
      .list({
        owner,
        card: cardId,
        category: categoryId,
        tag: tagId,
        direction,
        search,
        date_from: toISO(rangeStart),
        date_to: toISO(rangeEnd),
        amount_min: amountMin,
        amount_max: amountMax,
      })
      .then(setTransactions)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [owner, cardId, categoryId, tagId, direction, search, amountMin, amountMax, rangeStart, rangeEnd])

  useEffect(() => {
    load()
    // A filter change can change which transactions are even visible, so a
    // stale selection (ids no longer on screen) would make "N selected"
    // lie - clear it whenever the filters (i.e. load's own identity) change.
    // This does *not* fire on the plain re-fetches below (adding a
    // transaction, bulk actions) since those call load() directly without
    // load itself changing identity.
    setSelectedIds(new Set())
  }, [load])

  useEffect(() => {
    if (!cashInEligible) {
      setIncomes([])
      return
    }
    api.income
      .list({ owner, date_from: toISO(rangeStart), date_to: toISO(rangeEnd) })
      .then(setIncomes)
      .catch((err) => setError(err.message))
  }, [owner, rangeStart, rangeEnd, cashInEligible])

  // /api/income/ doesn't support amount_min/amount_max or search like
  // /api/transactions/ does, so both are applied client-side here instead -
  // income lists are small (a handful of paychecks a month), so this is
  // cheap. Search matches against `source`, the closest thing income has to
  // a transaction's description.
  const filteredIncomes = useMemo(() => {
    return incomes.filter((i) => {
      const amt = Number(i.amount)
      if (amountMin !== '' && amt < Number(amountMin)) return false
      if (amountMax !== '' && amt > Number(amountMax)) return false
      if (search && !(i.source || '').toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [incomes, amountMin, amountMax, search])

  // A single combined, date-sorted list for rendering - Income entries
  // don't have a card/category/tags/notes/location like a Transaction does,
  // so they render with their own distinct row (see IncomeRow below) rather
  // than being coerced into the same shape.
  const mergedItems = useMemo(() => {
    const txItems = transactions.map((t) => ({ kind: 'transaction', date: t.date, data: t }))
    const incomeItems = filteredIncomes.map((i) => ({ kind: 'income', date: i.date, data: i }))
    return [...txItems, ...incomeItems].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [transactions, filteredIncomes])

  const tagSuggestions = useMemo(() => tags.map((t) => t.name), [tags])

  function handleTransactionAdded() {
    load()
    api.tags.list().then(setTags).catch(() => {})
    api.locations.list().then(setLocations).catch(() => {})
  }

  async function handleSaveEdit(changes) {
    const t = editingTransaction
    setEditingTransaction(null)
    try {
      // Category changes go through recategorize() (not the generic PATCH
      // below) so it still teaches a MerchantRule, same as everywhere else
      // in this app - only call it if the category actually changed, so an
      // edit that only touched notes/location/tags doesn't also re-teach an
      // unchanged rule.
      if (changes.category !== (t.category ?? null)) {
        await api.transactions.recategorize(t.id, changes.category)
      }
      const updated = await api.transactions.update(t.id, {
        location: changes.location,
        notes: changes.notes,
        tags: changes.tags,
      })
      setTransactions((txs) => txs.map((tx) => (tx.id === t.id ? { ...tx, ...updated } : tx)))
      api.tags.list().then(setTags).catch(() => {})
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  async function confirmDelete() {
    const t = pendingDelete
    setPendingDelete(null)
    const previous = transactions
    setTransactions((txs) => txs.filter((tx) => tx.id !== t.id))
    try {
      await api.transactions.remove(t.id)
    } catch (err) {
      setTransactions(previous)
      setError(err.message)
    }
  }

  async function confirmIncomeDelete() {
    const entry = pendingIncomeDelete
    setPendingIncomeDelete(null)
    const previous = incomes
    setIncomes((prev) => prev.filter((i) => i.id !== entry.id))
    try {
      await api.income.remove(entry.id)
    } catch (err) {
      setIncomes(previous)
      setError(err.message)
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    setSelectedIds(new Set(transactions.map((t) => t.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  async function handleBulkSave({ categoryProvided, category, addTags }) {
    const ids = [...selectedIds]
    setShowBulkEdit(false)
    try {
      const body = {}
      if (categoryProvided) body.category = category
      if (addTags.length > 0) body.add_tags = addTags
      const updated = await api.transactions.bulkUpdate(ids, body)
      const byId = Object.fromEntries(updated.map((t) => [t.id, t]))
      setTransactions((txs) => txs.map((tx) => (byId[tx.id] ? { ...tx, ...byId[tx.id] } : tx)))
      setSelectedIds(new Set())
      if (addTags.length > 0) api.tags.list().then(setTags).catch(() => {})
    } catch (err) {
      setError(err.message)
      load()
    }
  }

  async function confirmBulkDelete() {
    const ids = [...selectedIds]
    setPendingBulkDelete(false)
    const previous = transactions
    setTransactions((txs) => txs.filter((tx) => !selectedIds.has(tx.id)))
    setSelectedIds(new Set())
    try {
      await api.transactions.bulkRemove(ids)
    } catch (err) {
      setTransactions(previous)
      setError(err.message)
    }
  }

  const categoryById = Object.fromEntries(categories.map((c) => [c.id, c]))

  return (
    <div className="stack">
      <h2>Transactions</h2>

      <button type="button" className="primary" onClick={() => setShowAddForm(true)}>
        + Add transaction
      </button>

      <DateFilter
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        customStart={customStart}
        onCustomStartChange={setCustomStart}
        customEnd={customEnd}
        onCustomEndChange={setCustomEnd}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
      >
        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Everyone</option>
          {users.map((u) => (
            <option key={u.id} value={u.username}>
              {u.username[0].toUpperCase() + u.username.slice(1)}
            </option>
          ))}
        </select>
      </DateFilter>

      <div className="filter-row">
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

        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="">Cash in & out</option>
          <option value="out">Cash out</option>
          <option value="in">Cash in</option>
        </select>

        <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-row">
        <input
          type="search"
          placeholder="Search description, location, or notes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          type="number"
          placeholder="Min $"
          value={amountMin}
          onChange={(e) => setAmountMin(e.target.value)}
        />
        <input
          type="number"
          placeholder="Max $"
          value={amountMax}
          onChange={(e) => setAmountMax(e.target.value)}
        />
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && mergedItems.length === 0 && (
        <p className="muted">
          {cashInEligible ? 'No transactions or income match these filters.' : 'No transactions match these filters.'}
        </p>
      )}

      {/* Bulk-select only ever applies to real Transaction rows - Income
          has no category/tags for the bulk-edit dialog to act on, so it's
          scoped to transactions.length, not the merged count. */}
      {!loading && transactions.length > 0 && (
        <div className="bulk-bar">
          <label className="select-all-row">
            <input
              type="checkbox"
              checked={selectedIds.size > 0 && selectedIds.size === transactions.length}
              ref={(el) => {
                if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < transactions.length
              }}
              onChange={(e) => (e.target.checked ? selectAllVisible() : clearSelection())}
            />
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
          </label>
          {/* Always rendered - never conditionally mounted - so the bar's
              height never changes on select/deselect (a jarring reflow the
              user flagged when this only appeared once something was
              selected). At 0 selected they're hidden via the invisible
              class (visibility: hidden - keeps their layout space, unlike
              display: none) rather than just disabled/dimmed, since the
              user wants them not shown at all until there's a selection. */}
          <button
            type="button"
            className={selectedIds.size === 0 ? 'invisible' : ''}
            disabled={selectedIds.size === 0}
            onClick={() => setShowBulkEdit(true)}
          >
            Edit selected
          </button>
          <button
            type="button"
            className={`link-button danger${selectedIds.size === 0 ? ' invisible' : ''}`}
            disabled={selectedIds.size === 0}
            onClick={() => setPendingBulkDelete(true)}
          >
            Delete selected
          </button>
          <button
            type="button"
            className={`link-button${selectedIds.size === 0 ? ' invisible' : ''}`}
            disabled={selectedIds.size === 0}
            onClick={clearSelection}
          >
            Clear
          </button>
        </div>
      )}

      <ul className="transaction-list">
        {mergedItems.map((item) => {
          if (item.kind === 'income') {
            const i = item.data
            return (
              <li key={`income-${i.id}`} className="transaction-row">
                {/* Disabled+hidden, not omitted - keeps this row's content
                    starting at the same indent as a transaction row's
                    (which has a real, interactive checkbox), so the merged
                    list doesn't visually jump between rows. Income never
                    participates in bulk-select. */}
                <input type="checkbox" className="transaction-select invisible" disabled tabIndex={-1} aria-hidden="true" />

                <div className="transaction-content">
                  <div className="transaction-tags">
                    <span className="income-badge">Income</span>
                  </div>

                  <div className="transaction-main">
                    <span className="category-dot" style={{ background: 'var(--accent)' }} />
                    <div className="transaction-desc">{i.source || 'Income'}</div>
                    <div className="amount positive">+{Number(i.amount).toFixed(2)}</div>
                  </div>

                  <div className="transaction-sub muted small">
                    {i.date} · {i.owner[0].toUpperCase() + i.owner.slice(1)}
                  </div>

                  <div className="transaction-actions">
                    <button className="link-button danger" onClick={() => setPendingIncomeDelete(i)}>
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            )
          }

          const t = item.data
          const category = categoryById[t.category]
          return (
            <li key={t.id} className={`transaction-row${selectedIds.has(t.id) ? ' selected' : ''}`}>
              <input
                type="checkbox"
                className="transaction-select"
                checked={selectedIds.has(t.id)}
                onChange={() => toggleSelect(t.id)}
                aria-label={`Select ${t.description}`}
              />

              <div className="transaction-content">
                {t.tags.length > 0 && (
                  <div className="transaction-tags">
                    {t.tags.map((tag) => (
                      <span key={tag} className="tag-pill">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="transaction-main">
                  <span
                    className="category-dot"
                    style={{ background: category ? category.color : 'var(--surface-3)' }}
                  />
                  <div className="transaction-desc">{t.description}</div>
                  <div className={`amount ${Number(t.amount) < 0 ? 'positive' : ''}`}>
                    {Number(t.amount) < 0 ? '+' : ''}
                    {Math.abs(Number(t.amount)).toFixed(2)}
                  </div>
                </div>

                <div className="transaction-sub muted small">
                  {t.date} · {category ? category.name : 'Uncategorized'}
                </div>
                <div className="transaction-sub muted small">
                  {t.owner[0].toUpperCase() + t.owner.slice(1)} · {t.card_name}
                </div>
                {t.location && <div className="transaction-sub muted small">📍 {t.location}</div>}

                <div className="transaction-actions">
                  <button className="link-button" onClick={() => setEditingTransaction(t)}>
                    Edit
                  </button>
                  <button className="link-button danger" onClick={() => setPendingDelete(t)}>
                    Delete
                  </button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {showAddForm && (
        <AddTransactionDialog
          cards={cards}
          categories={categories}
          locationSuggestions={locations}
          tagSuggestions={tagSuggestions}
          onAdded={handleTransactionAdded}
          onClose={() => setShowAddForm(false)}
        />
      )}

      {editingTransaction && (
        <EditTransactionDialog
          key={editingTransaction.id}
          transaction={editingTransaction}
          categories={categories}
          locationSuggestions={locations}
          tagSuggestions={tagSuggestions}
          onSave={handleSaveEdit}
          onCancel={() => setEditingTransaction(null)}
        />
      )}

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete transaction?"
        message={
          pendingDelete &&
          `"${pendingDelete.description}" ($${Math.abs(Number(pendingDelete.amount)).toFixed(2)}) will be permanently deleted.`
        }
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={!!pendingIncomeDelete}
        title="Delete income entry?"
        message={
          pendingIncomeDelete &&
          `"${pendingIncomeDelete.source || 'Income'}" ($${Number(pendingIncomeDelete.amount).toFixed(2)} on ${pendingIncomeDelete.date}) will be permanently deleted.`
        }
        onConfirm={confirmIncomeDelete}
        onCancel={() => setPendingIncomeDelete(null)}
      />

      {showBulkEdit && (
        <BulkEditDialog
          count={selectedIds.size}
          categories={categories}
          tagSuggestions={tagSuggestions}
          onSave={handleBulkSave}
          onCancel={() => setShowBulkEdit(false)}
        />
      )}

      <ConfirmDialog
        open={pendingBulkDelete}
        title={`Delete ${selectedIds.size} transaction${selectedIds.size === 1 ? '' : 's'}?`}
        message={`${selectedIds.size} transaction${selectedIds.size === 1 ? '' : 's'} will be permanently deleted.`}
        onConfirm={confirmBulkDelete}
        onCancel={() => setPendingBulkDelete(false)}
      />
    </div>
  )
}
