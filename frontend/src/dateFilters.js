export function toISO(d) {
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
export function getRecentMonthOptions(count = 12) {
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

export function getDateRange(dateFilter, customStart, customEnd) {
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
