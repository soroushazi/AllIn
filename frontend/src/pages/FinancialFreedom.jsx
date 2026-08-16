import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { useUsers } from '../hooks'

// Fixed by position (lower id first), not by username, so colors don't
// shift around if someone renames their login username.
const SLOT_COLORS = ['#2a78d6', '#eb6834']
const MILESTONES = [1000, 10000, 50000, 100000, 200000]
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
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function Segment({ title, total, maxTotal, color, accounts }) {
  return (
    <div className="card">
      <div className="budget-header">
        <span className="budget-name">{title}</span>
        <span className="muted">{fmt(total)}</span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${(total / maxTotal) * 100}%`, background: color }} />
      </div>
      {accounts.length > 0 && (
        <ul className="summary-list" style={{ marginTop: 10 }}>
          {accounts.map((a) => (
            <li key={a.id}>
              {a.name} <span className="muted small">· {CATEGORY_LABELS[a.category]}</span> -{' '}
              {a.latest_balance != null ? fmt(a.latest_balance) : <span className="muted">not logged yet</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function FinancialFreedom() {
  const [users] = useUsers()
  const [summary, setSummary] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([api.networth.summary(), api.networth.accounts.list()])
      .then(([summ, accts]) => {
        setSummary(summ)
        setAccounts(accts)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const currentNetWorth = Number(summary?.current_net_worth ?? 0)
  const freedomNumber = summary?.freedom_number != null ? Number(summary.freedom_number) : null
  const byOwner = summary?.by_owner ?? {}

  const nextGoal = useMemo(() => {
    const goals = MILESTONES.map((amount) => ({ amount, isFreedom: false }))
    if (freedomNumber) goals.push({ amount: freedomNumber, isFreedom: true })
    goals.sort((a, b) => a.amount - b.amount)
    return goals.find((g) => g.amount > currentNetWorth)
  }, [freedomNumber, currentNetWorth])

  const nextGoalPct = nextGoal ? Math.min(100, Math.max(0, (currentNetWorth / nextGoal.amount) * 100)) : 100
  const freedomPct = freedomNumber ? Math.min(100, Math.max(0, (currentNetWorth / freedomNumber) * 100)) : 0

  const history = (summary?.history ?? []).map((h) => ({ date: h.date.slice(5), net_worth: Number(h.net_worth) }))

  const assetAccounts = accounts.filter((a) => ASSET_CATEGORIES.includes(a.category))
  const liabilityAccounts = accounts.filter((a) => LIABILITY_CATEGORIES.includes(a.category))
  const totalAssets = assetAccounts.reduce((sum, a) => sum + Number(a.latest_balance ?? 0), 0)
  const totalLiabilities = liabilityAccounts.reduce((sum, a) => sum + Number(a.latest_balance ?? 0), 0)
  const maxTotal = Math.max(totalAssets, totalLiabilities, 1)

  return (
    <div className="stack">
      <h2>Financial Freedom</h2>

      {error && <div className="error-text">{error}</div>}
      {loading && <p className="muted">Loading...</p>}

      {!loading && (
        <>
          <div className="card stat-tile">
            <div className="muted small">Household net worth</div>
            <div className="stat-number">{fmt(currentNetWorth)}</div>
          </div>

          {Object.keys(byOwner).length > 0 && (
            <div className="card">
              <div className="person-stats">
                {users.map((u, i) => (
                  <div key={u.id}>
                    <span className="legend-dot" style={{ background: SLOT_COLORS[i] }} />
                    {u.username[0].toUpperCase() + u.username.slice(1)}: <strong>{fmt(byOwner[u.username] ?? 0)}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card">
            <div className="budget-header">
              <span className="budget-name">{nextGoal ? `Next goal · ${fmt(nextGoal.amount)}` : 'Next goal'}</span>
              <span className="muted">{nextGoalPct.toFixed(0)}%</span>
            </div>
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${nextGoalPct}%`, background: 'var(--accent)' }} />
            </div>
            <div className="muted small" style={{ marginTop: 6 }}>
              {nextGoal ? `${fmt(nextGoal.amount - currentNetWorth)} to go` : 'All goals reached!'}
            </div>
          </div>

          <div className="card">
            <div className="muted small" style={{ marginBottom: 8 }}>
              Path to financial freedom
            </div>
            {freedomNumber ? (
              <>
                <div className="budget-header">
                  <span className="budget-name">25x yearly expense · {fmt(freedomNumber)}</span>
                  <span className="muted">{freedomPct.toFixed(0)}%</span>
                </div>
                <div className="meter-track">
                  <div className="meter-fill" style={{ width: `${freedomPct}%`, background: 'var(--chart-line)' }} />
                </div>
                <div className="muted small" style={{ marginTop: 6 }}>
                  {freedomPct >= 100 ? 'Reached!' : `${fmt(freedomNumber - currentNetWorth)} to go`}
                </div>
              </>
            ) : (
              <p className="muted small">
                Set your average yearly expense in Net worth accounts (menu icon, top right) to calculate your
                freedom goal.
              </p>
            )}
          </div>

          <Segment title="Assets" total={totalAssets} maxTotal={maxTotal} color="var(--accent)" accounts={assetAccounts} />
          <Segment
            title="Liabilities"
            total={totalLiabilities}
            maxTotal={maxTotal}
            color="var(--danger)"
            accounts={liabilityAccounts}
          />

          {history.length >= 2 && (
            <div className="card">
              <div className="muted small" style={{ marginBottom: 8 }}>
                Net worth over time
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={history} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border)', fontSize: 12 }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                    formatter={(value) => [fmt(value), 'Net worth']}
                  />
                  <Area
                    type="monotone"
                    dataKey="net_worth"
                    stroke="var(--chart-line)"
                    fill="var(--chart-line)"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
