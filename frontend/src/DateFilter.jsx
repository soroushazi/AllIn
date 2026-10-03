import { MONTH_NAMES, monthFilterValue, toISO } from './dateFilters'

// Year choices for the "Specific month" picker: this year back five years.
const thisYear = new Date().getFullYear()
const yearOptions = Array.from({ length: 6 }, (_, i) => thisYear - i)

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
  // A specific month is stored as "month:YYYY-MM" but shown as one
  // "Specific month..." entry in the main select, with separate Month and
  // Year pickers revealed below it (same pattern as "Custom range...").
  const isSpecificMonth = dateFilter.startsWith('month:')
  const [selectedYear, selectedMonth] = isSpecificMonth ? dateFilter.slice(6).split('-').map(Number) : []

  function handleMainChange(value) {
    if (value === 'month') {
      const today = new Date()
      onDateFilterChange(monthFilterValue(today.getFullYear(), today.getMonth()))
    } else {
      onDateFilterChange(value)
    }
  }

  return (
    <>
      <div className="filter-row">
        <select value={isSpecificMonth ? 'month' : dateFilter} onChange={(e) => handleMainChange(e.target.value)}>
          <option value="last_week">Last week</option>
          <option value="mtd">Month to date</option>
          <option value="ytd">Year to date</option>
          <option value="last_month">Last month</option>
          <option value="last_year">Last year</option>
          <option value="all_time">All time</option>
          <option value="month">Specific month...</option>
          <option value="custom">Custom range...</option>
        </select>
        {children}
      </div>

      {isSpecificMonth && (
        <div className="filter-row">
          <select
            aria-label="Month"
            value={selectedMonth - 1}
            onChange={(e) => onDateFilterChange(monthFilterValue(selectedYear, Number(e.target.value)))}
          >
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="Year"
            value={selectedYear}
            onChange={(e) => onDateFilterChange(monthFilterValue(Number(e.target.value), selectedMonth - 1))}
          >
            {/* Keep an older selected year visible even if it's outside the default range. */}
            {(yearOptions.includes(selectedYear) ? yearOptions : [...yearOptions, selectedYear]).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}

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
