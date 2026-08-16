import { useEffect, useState } from 'react'
import { api } from '../api'
import { toISO } from '../dateFilters'
import { useUsers } from '../hooks'
import ConfirmDialog from '../ConfirmDialog'

// YearlyExpense's per-person scope keys are fixed internal identifiers
// established when these two accounts were first created - not the live
// username. Position 0 in useUsers() (lower id, i.e. whoever was created
// first) is permanently the "soroush" slot, position 1 is "shiva" - so a
// rename doesn't orphan an already-set yearly expense value. The scope
// values sent to the API never change; only the displayed label does.
const EXPENSE_SCOPES = ['household', 'soroush', 'shiva']
const SCOPE_SLOT_INDEX = { soroush: 0, shiva: 1 }
const CATEGORY_LABELS = {
  savings: 'Savings',
  investment: 'Investment',
  loan: 'Loan',
  asset: 'Other asset',
  liability: 'Other liability',
}
const ASSET_CATEGORIES = ['savings', 'investment', 'asset']
const LIABILITY_CATEGORIES = ['loan', 'liability']

function fmt(n) {
  const v = Number(n)
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function todayISO() {
  return toISO(new Date())
}

function scopeLabel(scope, users) {
  if (scope === 'household') return 'Household'
  const u = users[SCOPE_SLOT_INDEX[scope]]
  return u ? u.username[0].toUpperCase() + u.username.slice(1) : scope[0].toUpperCase() + scope.slice(1)
}

export default function NetWorthAccounts() {
  const [users] = useUsers()
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [expenses, setExpenses] = useState({})
  const [expenseScope, setExpenseScope] = useState('household')
  const [expenseInput, setExpenseInput] = useState('')
  const [savingExpense, setSavingExpense] = useState(false)

  const [newAccount, setNewAccount] = useState({ owner: '', name: '', category: 'savings' })
  const [creatingAccount, setCreatingAccount] = useState(false)

  const [balanceDrafts, setBalanceDrafts] = useState({})
  const [savingBalanceId, setSavingBalanceId] = useState(null)

  const [pendingDeleteAccount, setPendingDeleteAccount] = useState(null)

  function load() {
    setLoading(true)
    setError(null)
    return Promise.all([api.networth.accounts.list(), api.networth.yearlyExpense.list()])
      .then(([accts, fetchedExpenses]) => {
        setAccounts(accts)
        setExpenses(fetchedExpenses)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    setExpenseInput(expenses[expenseScope] ?? '')
  }, [expenses, expenseScope])

  useEffect(() => {
    if (users.length > 0 && !newAccount.owner) setNewAccount((a) => ({ ...a, owner: users[0].username }))
  }, [users, newAccount.owner])

  function draftFor(accountId) {
    return balanceDrafts[accountId] ?? { amount: '', date: todayISO() }
  }

  function updateBalanceDraft(accountId, patch) {
    setBalanceDrafts((d) => ({ ...d, [accountId]: { ...draftFor(accountId), ...patch } }))
  }

  async function handleSaveExpense() {
    if (!expenseInput) return
    setSavingExpense(true)
    setError(null)
    try {
      await api.networth.yearlyExpense.set(expenseScope, expenseInput)
      setExpenses((e) => ({ ...e, [expenseScope]: expenseInput }))
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingExpense(false)
    }
  }

  async function handleCreateAccount(e) {
    e.preventDefault()
    if (!newAccount.name.trim()) return
    setCreatingAccount(true)
    setError(null)
    try {
      const created = await api.networth.accounts.create({ ...newAccount, name: newAccount.name.trim() })
      setAccounts((a) => [...a, created])
      setNewAccount({ owner: users[0]?.username || '', name: '', category: 'savings' })
    } catch (err) {
      setError(err.message)
    } finally {
      setCreatingAccount(false)
    }
  }

  async function handleLogBalance(account) {
    const draft = draftFor(account.id)
    if (!draft.amount) return
    setSavingBalanceId(account.id)
    setError(null)
    try {
      await api.networth.entries.create({
        account: account.id,
        date: draft.date || todayISO(),
        balance: draft.amount,
      })
      const accts = await api.networth.accounts.list()
      setAccounts(accts)
      setBalanceDrafts((d) => {
        const next = { ...d }
        delete next[account.id]
        return next
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingBalanceId(null)
    }
  }

  async function confirmDeleteAccount() {
    const account = pendingDeleteAccount
    setPendingDeleteAccount(null)
    setError(null)
    try {
      await api.networth.accounts.remove(account.id)
      setAccounts((a) => a.filter((x) => x.id !== account.id))
    } catch (err) {
      setError(err.message)
    }
  }

  const assetAccounts = accounts.filter((a) => ASSET_CATEGORIES.includes(a.category))
  const liabilityAccounts = accounts.filter((a) => LIABILITY_CATEGORIES.includes(a.category))
  const totalAssets = assetAccounts.reduce((sum, a) => sum + Number(a.latest_balance ?? 0), 0)
  const totalLiabilities = liabilityAccounts.reduce((sum, a) => sum + Number(a.latest_balance ?? 0), 0)
  const maxTotal = Math.max(totalAssets, totalLiabilities, 1)

  function renderAccountRow(account) {
    const draft = draftFor(account.id)
    return (
      <li key={account.id} className="category-row card stack">
        <div className="transaction-desc">
          <div>
            {account.name}
            <span className="muted small"> · {CATEGORY_LABELS[account.category]}</span>
          </div>
          <div className="muted small">
            {account.owner[0].toUpperCase() + account.owner.slice(1)} -{' '}
            {account.latest_balance != null ? `${fmt(account.latest_balance)} as of ${account.latest_date}` : 'no balance logged yet'}
          </div>
        </div>
        <div className="filter-row">
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Balance"
            value={draft.amount}
            onChange={(e) => updateBalanceDraft(account.id, { amount: e.target.value })}
          />
          <input type="date" value={draft.date} onChange={(e) => updateBalanceDraft(account.id, { date: e.target.value })} />
        </div>
        <div className="transaction-actions">
          <button
            type="button"
            className="primary"
            disabled={savingBalanceId === account.id || !draft.amount}
            onClick={() => handleLogBalance(account)}
          >
            {savingBalanceId === account.id ? 'Saving...' : 'Log balance'}
          </button>
          <button type="button" className="link-button danger" onClick={() => setPendingDeleteAccount(account)}>
            Delete
          </button>
        </div>
      </li>
    )
  }

  return (
    <div className="stack">
      <h2>Net worth accounts</h2>

      {error && <div className="error-text">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && (
        <>
          <div className="card stack">
            <h3>Average yearly expense</h3>
            <p className="muted small">
              Answer this for the household as a whole, or per person - whichever's easier. If a household amount is
              set, it's used directly; otherwise it's the sum of whatever per-person amounts are set. The Financial
              Freedom goal is 25x this total.
            </p>
            <div className="user-toggle">
              {EXPENSE_SCOPES.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  className={scope === expenseScope ? 'active' : ''}
                  onClick={() => setExpenseScope(scope)}
                >
                  {scopeLabel(scope, users)}
                </button>
              ))}
            </div>
            <div className="filter-row">
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 30000"
                value={expenseInput}
                onChange={(e) => setExpenseInput(e.target.value)}
              />
              <button type="button" className="primary" disabled={savingExpense || !expenseInput} onClick={handleSaveExpense}>
                {savingExpense ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="budget-header">
              <span className="budget-name">Assets</span>
              <span className="muted">{fmt(totalAssets)}</span>
            </div>
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${(totalAssets / maxTotal) * 100}%`, background: 'var(--accent)' }} />
            </div>
            {assetAccounts.length > 0 && (
              <ul className="category-list" style={{ marginTop: 12 }}>
                {assetAccounts.map(renderAccountRow)}
              </ul>
            )}
          </div>

          <div className="card">
            <div className="budget-header">
              <span className="budget-name">Liabilities</span>
              <span className="muted">{fmt(totalLiabilities)}</span>
            </div>
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${(totalLiabilities / maxTotal) * 100}%`, background: 'var(--danger)' }} />
            </div>
            {liabilityAccounts.length > 0 && (
              <ul className="category-list" style={{ marginTop: 12 }}>
                {liabilityAccounts.map(renderAccountRow)}
              </ul>
            )}
          </div>

          <details className="card">
            <summary>Add account</summary>
            <form className="stack" onSubmit={handleCreateAccount} style={{ marginTop: 10 }}>
              <div className="filter-row">
                <select value={newAccount.owner} onChange={(e) => setNewAccount({ ...newAccount, owner: e.target.value })}>
                  {users.map((u) => (
                    <option key={u.id} value={u.username}>
                      {u.username[0].toUpperCase() + u.username.slice(1)}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Name (e.g. SoFi Savings)"
                  value={newAccount.name}
                  onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                  required
                />
                <select value={newAccount.category} onChange={(e) => setNewAccount({ ...newAccount, category: e.target.value })}>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="primary" disabled={creatingAccount || !newAccount.name.trim()}>
                {creatingAccount ? 'Adding...' : 'Add account'}
              </button>
            </form>
          </details>
        </>
      )}

      <ConfirmDialog
        open={!!pendingDeleteAccount}
        title="Delete account?"
        message={
          pendingDeleteAccount &&
          `"${pendingDeleteAccount.name}" and its logged balance history will be permanently deleted.`
        }
        onConfirm={confirmDeleteAccount}
        onCancel={() => setPendingDeleteAccount(null)}
      />
    </div>
  )
}
