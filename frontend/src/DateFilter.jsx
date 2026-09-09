import { getRecentMonthOptions, toISO } from './dateFilters'

const monthOptions = getRecentMonthOptions()

export default function DateFilter({
  dateFilter,
  onDateFilterChange,
  customStart,
  onCustomStartChange,
  customEnd,
  onCustomEndChange,
  rangeStart,
  rangeEnd,
  children,
}) {
  return (
    <>
      <div className="filter-row">
        <select value={dateFilter} onChange={(e) => onDateFilterChange(e.target.value)}>
          <option value="last_week">Last week</option>
          <option value="mtd">Month to date</option>
          <option value="ytd">Year to date</option>
          <option value="last_month">Last month</option>
          <option value="last_year">Last year</option>
          <option value="all_time">All time</option>
          <optgroup label="Specific month">
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </optgroup>
          <option value="custom">Custom range...</option>
        </select>
        {children}
      </div>

      {dateFilter === 'custom' && (
        <div className="filter-row">
          <label>
            From
            <input type="date" value={customStart} onChange={(e) => onCustomStartChange(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customEnd} onChange={(e) => onCustomEndChange(e.target.value)} />
          </label>
        </div>
      )}

      <p className="muted small">
        {toISO(rangeStart)} to {toISO(rangeEnd)}
      </p>
    </>
  )
}
