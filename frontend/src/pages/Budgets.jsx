import { useEffect, useState } from 'react'
import { api } from '../api'

export default function Budgets() {
  const [period, setPeriod] = useState('weekly')
  const [owner, setOwner] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.budgets
      .summary({ period, owner })
      .then(setData)
      .catch((err) => setError(err.message))
  }, [period, owner])

  return (
    <div className="stack">
      <h2>Budgets</h2>

      <div className="filter-row">
        <div className="user-toggle">
          <button className={period === 'weekly' ? 'active' : ''} onClick={() => setPeriod('weekly')}>
            Weekly
          </button>
          <button className={period === 'monthly' ? 'active' : ''} onClick={() => setPeriod('monthly')}>
            Monthly
          </button>
        </div>

        <select value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">Combined</option>
          <option value="soroush">Soroush</option>
          <option value="shiva">Shiva</option>
        </select>
      </div>

      {error && <div className="error-text">{error}</div>}

      {data && (
        <>
          <p className="muted small">
            {data.start} to {data.end}
          </p>

          {data.results.length === 0 && (
            <p className="muted">No categories have a {period} budget set yet.</p>
          )}

          <ul className="budget-list">
            {data.results.map((r) => {
              const budget = Number(r.budget)
              const spent = Number(r.spent)
              const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0
              const over = spent > budget

              return (
                <li key={r.category_id} className="budget-row">
                  <div className="budget-header">
                    <span className="budget-name">{r.category_name}</span>
                    <span className={over ? 'over-budget' : 'muted'}>
                      ${spent.toFixed(2)} / ${budget.toFixed(2)}
                    </span>
                  </div>
                  <div className="meter-track">
                    <div
                      className="meter-fill"
                      style={{ width: `${pct}%`, background: r.color }}
                    />
                  </div>
                  {over && <div className="over-budget small">${(spent - budget).toFixed(2)} over budget</div>}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
