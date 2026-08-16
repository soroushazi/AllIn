import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { useUsers } from '../hooks'

export default function Login() {
  const { login } = useAuth()
  const [users] = useUsers()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (users.length > 0 && !username) setUsername(users[0].username)
  }, [users, username])

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
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              className={u.username === username ? 'active' : ''}
              onClick={() => setUsername(u.username)}
            >
              {u.username[0].toUpperCase() + u.username.slice(1)}
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
