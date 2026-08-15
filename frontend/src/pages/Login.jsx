import { useState } from 'react'
import { useAuth } from '../AuthContext'

const USERS = ['soroush', 'shiva']

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState(USERS[0])
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(username, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Jiring</h1>
        <p className="muted">Household expenses</p>

        <div className="user-toggle">
          {USERS.map((u) => (
            <button
              key={u}
              type="button"
              className={u === username ? 'active' : ''}
              onClick={() => setUsername(u)}
            >
              {u[0].toUpperCase() + u.slice(1)}
            </button>
          ))}
        </div>

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />

        {error && <div className="error-text">{error}</div>}

        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
