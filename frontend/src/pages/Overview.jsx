import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, AreaChart, Area, ReferenceLine } from 'recharts'
import { api } from '../api'
import { useCards, useCategories, useTags, useUsers } from '../hooks'
import DateFilter from '../DateFilter'
import { getDateRange, parseISODateLocal, toISO } from '../dateFilters'

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
  const [cards] = useCards()
  const [users] = useUsers()
  const [tags] = useTags()
  const [dateFilter, setDateFilter] = useState('mtd')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [owner, setOwner] = useState('')
  const [cardId, setCardId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [tagId, setTagId] = useState('')
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
  const isMonthlyPeriod = dateFilter === 'mtd' || dateFilter === 'last_month' || dateFilter.startsWith('month:')

  // Picking a tag (e.g. a trip) jumps the date range to All time, since the
  // tagged transactions could fall anywhere - the user can still narrow the
  // range again afterward, this only fires when the tag itself changes.
  useEffect(() => {
    if (tagId !== '') setDateFilter('all_time')
  }, [tagId])

  useEffect(() => {
    api.transactions
      .list({
        owner,
        card: cardId,
        category: categoryId,
        tag: tagId,
        direction,
        date_from: toISO(rangeStart),
        date_to: toISO(rangeEnd),
        amount_min: amountMin,
        amount_max: amountMax,
      })
      .then(setTransactions)
      .catch((err) => setError(err.message))
  }, [owner, cardId, categoryId, tagId, direction, amountMin, amountMax, rangeStart, rangeEnd])

  const isCashInOnly = direction === 'in'
  // "" is the re-added "Cash in & out" option (see the direction <select>
  // below) - both directions included at once, e.g. to see a trip tag's
  // full picture when you paid upfront (cash out) and got reimbursed later
  // (cash in).
  const isCombined = direction === ''
  // "" is "All categories" - anything else (a real category id, or the
  // "uncategorized" sentinel) is a single-category view, where a breakdown
  // by category, a budget comparison across categories, or an income
  // comparison against only-that-category spending don't mean anything.
  const isCategoryFiltered = categoryId !== ''
  // A min/max amount filter narrows to a subset of transactions by size, not
  // by category - a budget or income comparison against that subset doesn't
  // mean anything either, same reasoning as isCategoryFiltered above.
  const isAmountFiltered = amountMin !== '' || amountMax !== ''
  // A tag narrows to an arbitrary cross-category subset (e.g. a trip), same
  // as an amount filter - a budget/income comparison against just that
  // subset isn't meaningful either.
  const isTagFiltered = tagId !== ''
  // Same reasoning again: a single card is a slice of spending that cuts
  // across categories (and a category's real monthly budget is meant to be
  // judged against spending on every card, not just one), so budget/income
  // comparisons don't mean anything scoped to one card either.
  const isCardFiltered = cardId !== ''

  useEffect(() => {
    if (!isMonthlyPeriod || isCategoryFiltered || isAmountFiltered || isTagFiltered || isCardFiltered) {
      setIncomes([])
      return
    }
    api.income
      .list({ owner, date_from: toISO(rangeStart), date_to: toISO(rangeEnd) })
      .then(setIncomes)
      .catch((err) => setError(err.message))
  }, [owner, rangeStart, rangeEnd, isMonthlyPeriod, isCategoryFiltered, isAmountFiltered, isTagFiltered, isCardFiltered])

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
    let minDate = null
    let maxDate = null
    for (const t of transactions) {
      const amt = Number(t.amount)
      // Combined mode sums the raw signed amount - this app already stores
      // spending positive and refunds/cash-in negative (see the sign-
      // convention notes throughout this file/repo), so the daily total
      // naturally comes out exactly as wanted: cash out pushes it positive,
      // cash in pushes it negative, no separate series needed. Cash-out-only
      // and Cash-in-only both plot the magnitude instead - the server
      // already returns only one sign for those (amount>0 / amount<0
      // respectively), and every other display of a cash-in figure in this
      // app (Total earned, By person) already flips it positive too, so a
      // standalone Cash in trend reads the same way rather than being an
      // all-negative chart with no offsetting positive side to contrast it
      // against.
      const value = isCombined ? amt : Math.abs(amt)
      totals[t.date] = (totals[t.date] || 0) + value
      // t.date is an ISO "YYYY-MM-DD" string, so plain string comparison
      // sorts correctly - no need to parse into Date objects just to find
      // the earliest/latest.
      if (minDate === null || t.date < minDate) minDate = t.date
      if (maxDate === null || t.date > maxDate) maxDate = t.date
    }
    // "All time" resolves to 2000-01-01..today (~9,700 days) - enumerating
    // every one of those as an x-axis point is both slow and visually
    // useless: real spending (e.g. a tag like a trip, which jumps the date
    // filter to All time since it could span any period - see the tagId
    // effect above) gets compressed into an imperceptible sliver among
    // thousands of empty days, which read as "the chart isn't showing my
    // spending" even though the data's there. Scope the plotted range to
    // just the span the matching transactions actually cover instead of
    // the full selected range - every other date-filter option (week/
    // month/year/custom) is already a reasonable width to show in full,
    // gaps included, so this only changes All time's behavior.
    //
    // minDate/maxDate must go through parseISODateLocal, not plain
    // `new Date(minDate)` - a bare "YYYY-MM-DD" string parses as UTC
    // midnight per spec, and reading it back via toISO's local getters
    // rolls the day back by one in any timezone behind UTC (confirmed: a
    // 09-01/09-02 tagged pair rendered as 08-31/09-01, silently dropping
    // the 09-02 transaction off the end of the range entirely).
    const spanStart = dateFilter === 'all_time' && minDate ? parseISODateLocal(minDate) : rangeStart
    const spanEnd = dateFilter === 'all_time' && maxDate ? parseISODateLocal(maxDate) : rangeEnd
    return enumerateDates(spanStart, spanEnd).map((date) => ({
      date: date.slice(5), // MM-DD
      value: Number((totals[date] || 0).toFixed(2)),
    }))
  }, [transactions, rangeStart, rangeEnd, dateFilter, isCombined])

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
        <select value={tagId} onChange={(e) => setTagId(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value)}>
          <option value="out">Cash out</option>
          <option value="in">Cash in</option>
          <option value="">Cash in & out</option>
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
        {!isCashInOnly && (
          <div className="card stat-tile" style={{ flex: 1 }}>
            <div className="muted small">Total spent</div>
            <div className="stat-number">${totalSpent.toFixed(2)}</div>
          </div>
        )}
        {(isCashInOnly || isCombined) && (
          <div className="card stat-tile" style={{ flex: 1 }}>
            <div className="muted small">Total earned</div>
            <div className="stat-number net-positive">${totalEarned.toFixed(2)}</div>
          </div>
        )}
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
                {isCombined ? (
                  <strong>
                    ${perPersonTotals[u.username].toFixed(2)} out / ${earnedByPersonTotals[u.username].toFixed(2)} in
                  </strong>
                ) : (
                  <strong>
                    ${(isCashInOnly ? earnedByPersonTotals[u.username] : perPersonTotals[u.username]).toFixed(2)}
                  </strong>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All three direction modes get a trend chart now - title/color/
          tooltip below all branch on which one, so "Spend trend" never
          mislabels what's actually plotted. */}
      <div className="card">
        <div className="muted small" style={{ marginBottom: isCombined ? 2 : 8 }}>
          {isCombined ? 'Cash flow trend' : isCashInOnly ? 'Cash in trend' : 'Spend trend'}
        </div>
        {isCombined && (
          <div className="muted small" style={{ marginBottom: 8 }}>
            Cash out shown above the line (+), cash in below it (−)
          </div>
        )}
        <ResponsiveContainer width="100%" height={isCombined ? 260 : 180}>
          <AreaChart data={trend} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              axisLine={false}
              tickLine={false}
              width={48}
              tickFormatter={isCombined ? (v) => (v === 0 ? '$0' : `${v > 0 ? '+' : '-'}$${Math.abs(v)}`) : undefined}
            />
            {isCombined && <ReferenceLine y={0} stroke="var(--text-secondary)" />}
            <Tooltip
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12 }}
              itemStyle={{ color: 'var(--text-primary)' }}
              labelStyle={{ color: 'var(--text-secondary)' }}
              formatter={
                isCombined
                  ? (value) => [`${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`, value < 0 ? 'Cash in' : 'Cash out']
                  : (value) => [`$${value.toFixed(2)}`, isCashInOnly ? 'Cash in' : 'Spent']
              }
            />
            <Area
              type="monotone"
              dataKey="value"
              // Cash in trend reuses the app's existing green "money in"
              // color (--accent, same as the Total earned tile/net-positive
              // text elsewhere) instead of the spend chart's blue, so it
              // reads as a distinct kind of figure at a glance.
              stroke={isCashInOnly ? 'var(--accent)' : 'var(--chart-line)'}
              fill={isCashInOnly ? 'var(--accent)' : 'var(--chart-line)'}
              fillOpacity={0.15}
              strokeWidth={2}
              // Same duration for all three direction modes (Recharts'
              // default) - a shorter one was tried for Cash in alone
              // (58eb90d) to counter its sparser/spikier curve, but the
              // user asked for all three to match rather than have Cash in
              // stand out as quicker than the other two.
              animationDuration={1500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

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

      {!isCashInOnly && !isCategoryFiltered && !isAmountFiltered && !isTagFiltered && !isCardFiltered && isMonthlyPeriod && budgetVsActual.length > 0 && (
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

      {!isCashInOnly && !isCategoryFiltered && !isAmountFiltered && !isTagFiltered && !isCardFiltered && isMonthlyPeriod && (
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
