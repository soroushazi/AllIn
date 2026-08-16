// Relative by default: the dev server proxies /api to the backend (see
// vite.config.js) and production serves both from one origin, so requests
// stay same-origin - no CORS, no cross-site cookie issues. Override only if
// frontend and backend are ever split across genuinely different domains.
const API_BASE = import.meta.env.VITE_API_URL || ''

function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[2]) : null
}

function buildQuery(params = {}) {
  const usp = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') usp.set(key, value)
  }
  const qs = usp.toString()
  return qs ? `?${qs}` : ''
}

function extractErrorMessage(data) {
  if (!data) return null
  if (data.detail) return data.detail
  if (typeof data === 'object') {
    const first = Object.values(data)[0]
    if (Array.isArray(first)) return first[0]
    if (typeof first === 'string') return first
  }
  return null
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {}
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') {
    const csrfToken = getCookie('csrftoken')
    if (csrfToken) headers['X-CSRFToken'] = csrfToken
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })

  if (!res.ok) {
    let data = null
    try {
      data = await res.json()
    } catch {
      // response body wasn't JSON - fall through with data = null
    }
    const error = new Error(extractErrorMessage(data) || res.statusText)
    error.status = res.status
    error.data = data
    throw error
  }

  if (res.status === 204) return null
  return res.json()
}

export const api = {
  csrf: () => request('/api/auth/csrf/'),
  login: (username, password) => request('/api/auth/login/', { method: 'POST', body: { username, password } }),
  logout: () => request('/api/auth/logout/', { method: 'POST' }),
  me: () => request('/api/auth/me/'),
  changePassword: (currentPassword, newPassword) =>
    request('/api/auth/change-password/', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    }),
  changeUsername: (newUsername) =>
    request('/api/auth/change-username/', { method: 'POST', body: { new_username: newUsername } }),

  users: {
    list: () => request('/api/auth/users/'),
  },

  categories: {
    list: () => request('/api/categories/'),
    create: (data) => request('/api/categories/', { method: 'POST', body: data }),
    update: (id, data) => request(`/api/categories/${id}/`, { method: 'PATCH', body: data }),
    remove: (id) => request(`/api/categories/${id}/`, { method: 'DELETE' }),
  },

  cards: {
    list: () => request('/api/cards/'),
    create: (data) => request('/api/cards/', { method: 'POST', body: data }),
    update: (id, data) => request(`/api/cards/${id}/`, { method: 'PATCH', body: data }),
    remove: (id) => request(`/api/cards/${id}/`, { method: 'DELETE' }),
  },

  transactions: {
    list: (params) => request(`/api/transactions/${buildQuery(params)}`),
    create: (data) => request('/api/transactions/', { method: 'POST', body: data }),
    update: (id, data) => request(`/api/transactions/${id}/`, { method: 'PATCH', body: data }),
    remove: (id) => request(`/api/transactions/${id}/`, { method: 'DELETE' }),
    recategorize: (id, category) =>
      request(`/api/transactions/${id}/recategorize/`, { method: 'PATCH', body: { category } }),
  },

  tags: {
    list: () => request('/api/tags/'),
  },

  locations: {
    list: () => request('/api/locations/'),
  },

  budgets: {
    summary: (params) => request(`/api/budgets/summary/${buildQuery(params)}`),
  },

  income: {
    list: (params) => request(`/api/income/${buildQuery(params)}`),
    create: (data) => request('/api/income/', { method: 'POST', body: data }),
    remove: (id) => request(`/api/income/${id}/`, { method: 'DELETE' }),
  },

  import: (formData) => request('/api/import/', { method: 'POST', body: formData, isForm: true }),
  importConfirm: (rows) => request('/api/import/confirm/', { method: 'POST', body: { rows } }),

  networth: {
    accounts: {
      list: (params) => request(`/api/networth/accounts/${buildQuery(params)}`),
      create: (data) => request('/api/networth/accounts/', { method: 'POST', body: data }),
      update: (id, data) => request(`/api/networth/accounts/${id}/`, { method: 'PATCH', body: data }),
      remove: (id) => request(`/api/networth/accounts/${id}/`, { method: 'DELETE' }),
    },
    entries: {
      list: (params) => request(`/api/networth/entries/${buildQuery(params)}`),
      create: (data) => request('/api/networth/entries/', { method: 'POST', body: data }),
      remove: (id) => request(`/api/networth/entries/${id}/`, { method: 'DELETE' }),
    },
    yearlyExpense: {
      list: () => request('/api/networth/yearly-expense/'),
      set: (scope, amount) => request('/api/networth/yearly-expense/', { method: 'POST', body: { scope, amount } }),
    },
    summary: () => request('/api/networth/summary/'),
  },
}
