import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, AreaChart, Area } from 'recharts'
import { api } from '../api'
import { useCategories } from '../hooks'

function toISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function monthRange(year, monthIndex) {
  return [new Date(year, monthIndex, 1), new Date(year, monthIndex + 1, 0)]
}

// Last 12 months (including the current one), newest first - for the
// "specific month" picker.
function getRecentMonthOptions(count = 12) {
  const today = new Date()
  const options = []
  for (let i = 0; i < count; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    options.push({
      value: `month:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`,
    })
  }
  return options
}

function getDateRange(dateFilter, customStart, customEnd) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (dateFilter === 'custom') {
    if (customStart && customEnd) return [new Date(customStart), new Date(customEnd)]
    return [today, today]
  }

  if (dateFilter.startsWith('month:')) {
    const [year, month] = dateFilter.slice(6).split('-').map(Number)
    return monthRange(year, month - 1)
  }

  switch (dateFilter) {
    case 'last_week': {
      const dayIndex = (today.getDay() + 6) % 7 // Monday = 0 ... Sunday = 6
      const thisWeekStart = new Date(today)
      thisWeekStart.setDate(today.getDate() - dayIndex)
      const start = new Date(thisWeekStart)
      start.setDate(thisWeekStart.getDate() - 7)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      return [start, end]
    }
    case 'ytd':
      return [new Date(today.getFullYear(), 0, 1), today]
    case 'last_month':
      return monthRange(today.getFullYear(), today.getMonth() - 1)
    case 'last_year':
      return [new Date(today.getFullYear() - 1, 0, 1), new Date(today.getFullYear() - 1, 11, 31)]
    case 'mtd':
    default:
      return [new Date(today.getFullYear(), today.getMonth(), 1), today]
  }
}

function enumerateDates(start, end) {
  const dates = []
  const cursor = new Date(start)
  while (cursor <= end) {
    dates.push(toISO(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

const OWNER_COLORS = { soroush: '#2a78d6', shiva: '#eb6834' }
const UNCATEGORIZED_COLOR = '#8a8a86'

const monthOptions = getRecentMonthOptions()

export default function Overview() {
  const [categories] = useCategories()
  const [dateFilter, setDateFilter] = useState('mtd')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [owner, setOwner] = useState('')
  const [categoryId, setCategoryId] = useState('')
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
        date_from: toISO(rangeStart),
        date_to: toISO(rangeEnd),
        amount_min: amountMin,
        amount_max: amountMax,
      })
      .then(setTransactions)
      .catch((err) => setError(err.message))
  }, [owner, categoryId, amountMin, amountMax, rangeStart, rangeEnd])

  useEffect(() => {
    api.income
      .list({ owner, date_from: toISO(rangeStart), date_to: toISO(rangeEnd) })
      .then(setIncomes)
      .catch((err) => setError(err.message))
  }, [owner, rangeStart, rangeEnd])

  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories])

  const totalSpent = useMemo(
    () => transactions.reduce((sum, t) => (Number(t.amount) > 0 ? sum + Number(t.amount) : sum), 0),
    [transactions]
  )

  const perPersonTotals = useMemo(() => {
    const totals = { soroush: 0, shiva: 0 }
    for (const t of transactions) {
      const amt = Number(t.amount)
      if (amt > 0 && t.owner in totals) totals[t.owner] += amt
    }
    return totals
  }, [transactions])

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
    const totals = { soroush: 0, shiva: 0 }
    for (const i of incomes) {
      if (i.owner in totals) totals[i.owner] += Number(i.amount)
    }
    return totals
  }, [incomes])

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

      <div className="filter-row">
        <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
          <option value="last_week">Last week</option>
          <option value="mtd">Month to date</option>
          <option value="ytd">Year to date</option>
          <option value="last_month">Last month</option>
          <option value="last_year">Last year</option>
          <optgroup label="Specific month">
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </optgroup>
          <option value="custom">Custom range...</option>
        </select>

        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Combined</option>
          <option value="soroush">Soroush</option>
          <option value="shiva">Shiva</option>
        </select>
      </div>

      {dateFilter === 'custom' && (
        <div className="filter-row">
          <label>
            From
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </label>
        </div>
      )}

      <p className="muted small">
        {toISO(rangeStart)} to {toISO(rangeEnd)}
      </p>

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
          <div className="muted small">Total spent</div>
          <div className="stat-number">${totalSpent.toFixed(2)}</div>
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
            <div>
              <span className="legend-dot" style={{ background: OWNER_COLORS.soroush }} />
              Soroush: <strong>${perPersonTotals.soroush.toFixed(2)}</strong>
            </div>
            <div>
              <span className="legend-dot" style={{ background: OWNER_COLORS.shiva }} />
              Shiva: <strong>${perPersonTotals.shiva.toFixed(2)}</strong>
            </div>
          </div>
        </div>
      )}

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
              formatter={(value) => [`$${value.toFixed(2)}`, 'Spent']}
            />
            <Area type="monotone" dataKey="value" stroke="var(--chart-line)" fill="var(--chart-line)" fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div className="muted small" style={{ marginBottom: 8 }}>
          By category
        </div>
        {breakdown.length === 0 && <p className="muted">No spending in this period.</p>}
        {breakdown.length > 0 && (
          <ResponsiveContainer width="100%" height={Math.max(120, breakdown.length * 36)}>
            <BarChart
              data={breakdown}
              layout="vertical"
              margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
              barCategoryGap={8}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 12, fill: 'var(--text-primary)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12 }}
                formatter={(value, name, entry) => [
                  `$${Number(value).toFixed(2)} (${entry.payload.pct.toFixed(0)}%)`,
                  'Spent',
                ]}
                cursor={{ fill: 'var(--surface-3)' }}
              />
              <Bar dataKey="value" radius={[4, 4, 4, 4]} maxBarSize={20}>
                {breakdown.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {isMonthlyPeriod && budgetVsActual.length > 0 && (
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

      <div className="card">
        <div className="muted small" style={{ marginBottom: 8 }}>
          Income vs spending
        </div>

        {!owner && (
          <div className="person-stats" style={{ marginBottom: 10 }}>
            <div>
              <span className="legend-dot" style={{ background: OWNER_COLORS.soroush }} />
              Soroush: <strong>${incomeByPerson.soroush.toFixed(2)}</strong>
            </div>
            <div>
              <span className="legend-dot" style={{ background: OWNER_COLORS.shiva }} />
              Shiva: <strong>${incomeByPerson.shiva.toFixed(2)}</strong>
            </div>
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
    </div>
  )
}
