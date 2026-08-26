import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, AreaChart, Area } from 'recharts'
import { api } from '../api'
import { useCategories, useUsers } from '../hooks'
import DateFilter from '../DateFilter'
import { getDateRange, toISO } from '../dateFilters'

function enumerateDates(start, end) {
  const dates = []
  const cursor = new Date(start)
  while (cursor <= end) {
    dates.push(toISO(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

// Fixed by position (lower id first), not by username, so colors don't
// shift around if someone renames their login username.
const SLOT_COLORS = ['#2a78d6', '#eb6834']
const UNCATEGORIZED_COLOR = '#8a8a86'

export default function Overview() {
  const [categories] = useCategories()
  const [users] = useUsers()
  const [dateFilter, setDateFilter] = useState('mtd')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [owner, setOwner] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [direction, setDirection] = useState('out')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [transactions, setTransactions] = useState([])
  const [incomes, setIncomes] = useState([])
  const [error, setError] = useState(null)

  const [rangeStart, rangeEnd] = useMemo(
    () => getDateRange(dateFilter, customStart, customEnd),
    [dateFilter, customStart, customEnd]
  )
  const isMonthlyPeriod = dateFilter === 'mtd' || dateFilter.startsWith('month:')

  useEffect(() => {
    api.transactions
      .list({
        owner,
        category: categoryId,
        direction,
        date_from: toISO(rangeStart),
        date_to: toISO(rangeEnd),
        amount_min: amountMin,
        amount_max: amountMax,
      })
      .then(setTransactions)
      .catch((err) => setError(err.message))
  }, [owner, categoryId, direction, amountMin, amountMax, rangeStart, rangeEnd])

  const isCashInOnly = direction === 'in'
  // "" is "All categories" - anything else (a real category id, or the
  // "uncategorized" sentinel) is a single-category view, where a breakdown
  // by category, a budget comparison across categories, or an income
  // comparison against only-that-category spending don't mean anything.
  const isCategoryFiltered = categoryId !== ''
  // A min/max amount filter narrows to a subset of transactions by size, not
  // by category - a budget or income comparison against that subset doesn't
  // mean anything either, same reasoning as isCategoryFiltered above.
  const isAmountFiltered = amountMin !== '' || amountMax !== ''

  useEffect(() => {
    if (!isMonthlyPeriod || isCategoryFiltered || isAmountFiltered) {
      setIncomes([])
      return
    }
    api.income
      .list({ owner, date_from: toISO(rangeStart), date_to: toISO(rangeEnd) })
      .then(setIncomes)
      .catch((err) => setError(err.message))
  }, [owner, rangeStart, rangeEnd, isMonthlyPeriod, isCategoryFiltered, isAmountFiltered])

  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])

  const totalSpent = useMemo(
    () => transactions.reduce((sum, t) => (Number(t.amount) > 0 ? sum + Number(t.amount) : sum), 0),
    [transactions]
  )

  const totalEarned = useMemo(
    () => transactions.reduce((sum, t) => (Number(t.amount) < 0 ? sum + Math.abs(Number(t.amount)) : sum), 0),
    [transactions]
  )

  const perPersonTotals = useMemo(() => {
    const totals = Object.fromEntries(users.map((u) => [u.username, 0]))
    for (const t of transactions) {
      const amt = Number(t.amount)
      if (amt > 0 && t.owner in totals) totals[t.owner] += amt
    }
    return totals
  }, [transactions, users])

  const earnedByPersonTotals = useMemo(() => {
    const totals = Object.fromEntries(users.map((u) => [u.username, 0]))
    for (const t of transactions) {
      const amt = Number(t.amount)
      if (amt < 0 && t.owner in totals) totals[t.owner] += Math.abs(amt)
    }
    return totals
  }, [transactions, users])

  const breakdown = useMemo(() => {
    const totals = {}
    for (const t of transactions) {
      const amt = Number(t.amount)
      if (amt <= 0) continue
      const key = t.category ?? 'uncategorized'
      totals[key] = (totals[key] || 0) + amt
    }
    const entries = Object.entries(totals)
      .map(([key, value]) => {
        if (key === 'uncategorized') return { name: 'Uncategorized', value, color: UNCATEGORIZED_COLOR }
        const cat = categoryById[key]
        return { name: cat?.name ?? key, value, color: cat?.color ?? UNCATEGORIZED_COLOR }
      })
      .sort((a, b) => b.value - a.value)
    const sum = entries.reduce((s, e) => s + e.value, 0)
    return entries.map((e) => ({ ...e, pct: sum > 0 ? (e.value / sum) * 100 : 0 }))
  }, [transactions, categoryById])

  const budgetVsActual = useMemo(() => {
    if (!isMonthlyPeriod) return []
    const spentByCategory = {}
    for (const t of transactions) {
      const amt = Number(t.amount)
      if (amt <= 0 || !t.category) continue
      spentByCategory[t.category] = (spentByCategory[t.category] || 0) + amt
    }
    return categories
      .filter((c) => c.monthly_budget != null)
      .map((c) => {
        const spent = spentByCategory[c.id] || 0
        const budget = Number(c.monthly_budget)
        const pct = budget > 0 ? (spent / budget) * 100 : 0
        return { id: c.id, name: c.name, color: c.color, spent, budget, pct }
      })
      .sort((a, b) => b.pct - a.pct)
  }, [categories, transactions, isMonthlyPeriod])

  const totalIncome = useMemo(() => incomes.reduce((sum, i) => sum + Number(i.amount), 0), [incomes])
  const net = totalIncome - totalSpent

  const incomeByPerson = useMemo(() => {
    const totals = Object.fromEntries(users.map((u) => [u.username, 0]))
    for (const i of incomes) {
      if (i.owner in totals) totals[i.owner] += Number(i.amount)
    }
    return totals
  }, [incomes, users])

  const trend = useMemo(() => {
    const totals = {}
    for (const t of transactions) {
      const amt = Number(t.amount)
      if (amt <= 0) continue
      totals[t.date] = (totals[t.date] || 0) + amt
    }
    return enumerateDates(rangeStart, rangeEnd).map((date) => ({
      date: date.slice(5), // MM-DD
      value: Number((totals[date] || 0).toFixed(2)),
    }))
  }, [transactions, rangeStart, rangeEnd])

  return (
    <div className="stack">
      <h2>Overview</h2>

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
          <option value="">Combined</option>
          {users.map((u) => (
            <option key={u.id} value={u.username}>
              {u.username[0].toUpperCase() + u.username.slice(1)}
            </option>
          ))}
        </select>
      </DateFilter>

      <div className="filter-row">
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
          <option value="out">Cash out</option>
          <option value="in">Cash in</option>
        </select>
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

      <div className="filter-row">
        <div className="card stat-tile" style={{ flex: 1 }}>
          <div className="muted small">{isCashInOnly ? 'Total earned' : 'Total spent'}</div>
          <div className={`stat-number ${isCashInOnly ? 'net-positive' : ''}`}>
            ${(isCashInOnly ? totalEarned : totalSpent).toFixed(2)}
          </div>
        </div>
        <div className="card stat-tile" style={{ flex: 1 }}>
          <div className="muted small">Transactions</div>
          <div className="stat-number">{transactions.length}</div>
        </div>
      </div>

      {!owner && (
        <div className="card">
          <div className="muted small" style={{ marginBottom: 8 }}>
            By person
          </div>
          <div className="person-stats">
            {users.map((u, i) => (
              <div key={u.id}>
                <span className="legend-dot" style={{ background: SLOT_COLORS[i] }} />
                {u.username[0].toUpperCase() + u.username.slice(1)}:{' '}
                <strong>
                  ${(isCashInOnly ? earnedByPersonTotals[u.username] : perPersonTotals[u.username]).toFixed(2)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {!isCashInOnly && (
        <div className="card">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Spend trend
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12 }}
                itemStyle={{ color: 'var(--text-primary)' }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={(value) => [`$${value.toFixed(2)}`, 'Spent']}
              />
              <Area type="monotone" dataKey="value" stroke="var(--chart-line)" fill="var(--chart-line)" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {!isCashInOnly && !isCategoryFiltered && (
        <div className="card">
          <div className="muted small" style={{ marginBottom: 8 }}>
            By category
          </div>
          {breakdown.length === 0 && <p className="muted">No spending in this period.</p>}
          {breakdown.length > 0 && (
            <ul className="budget-list">
              {breakdown.map((entry) => (
                <li key={entry.name} className="budget-row">
                  <div className="budget-header">
                    <span className="budget-name">{entry.name}</span>
                    <span className="muted">
                      ${entry.value.toFixed(2)} ({entry.pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="meter-track">
                    <div className="meter-fill" style={{ width: `${entry.pct}%`, background: entry.color }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isCashInOnly && !isCategoryFiltered && !isAmountFiltered && isMonthlyPeriod && budgetVsActual.length > 0 && (
        <div className="card">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Budget vs actual
          </div>
          <ul className="budget-list">
            {budgetVsActual.map((b) => {
              const over = b.spent > b.budget
              return (
                <li key={b.id} className="budget-row">
                  <div className="budget-header">
                    <span className="budget-name">{b.name}</span>
                    <span className={over ? 'over-budget' : 'muted'}>
                      ${b.spent.toFixed(2)} / ${b.budget.toFixed(2)} ({b.pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{ width: `${Math.min(100, b.pct)}%`, background: b.color }}
                    />
                  </div>
                  {over && <div className="over-budget small">${(b.spent - b.budget).toFixed(2)} over budget</div>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {!isCashInOnly && !isCategoryFiltered && !isAmountFiltered && isMonthlyPeriod && (
        <div className="card">
          <div className="muted small" style={{ marginBottom: 8 }}>
            Income vs spending
          </div>

          {!owner && (
            <div className="person-stats" style={{ marginBottom: 10 }}>
              {users.map((u, i) => (
                <div key={u.id}>
                  <span className="legend-dot" style={{ background: SLOT_COLORS[i] }} />
                  {u.username[0].toUpperCase() + u.username.slice(1)}:{' '}
                  <strong>${(incomeByPerson[u.username] ?? 0).toFixed(2)}</strong>
                </div>
              ))}
            </div>
          )}

          <div className="budget-header">
            <span className="muted">Income</span>
            <span>${totalIncome.toFixed(2)}</span>
          </div>
          <div className="budget-header">
            <span className="muted">Spent</span>
            <span>${totalSpent.toFixed(2)}</span>
          </div>
          <div className="budget-header" style={{ marginTop: 4 }}>
            <span className="budget-name">Net</span>
            <span className={net >= 0 ? 'net-positive' : 'over-budget'}>
              {net >= 0 ? '+' : '-'}${Math.abs(net).toFixed(2)}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
