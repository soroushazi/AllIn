import { useEffect, useState } from 'react'
import { useAuth } from '../AuthContext'
import { api } from '../api'

export default function Account() {
  const { user, setUser } = useAuth()

  const [newUsername, setNewUsername] = useState('')
  const [usernameSubmitting, setUsernameSubmitting] = useState(false)
  const [usernameError, setUsernameError] = useState(null)
  const [usernameSuccess, setUsernameSuccess] = useState(false)

  useEffect(() => {
    if (user?.username) setNewUsername(user.username)
  }, [user?.username])

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  async function handleUsernameSubmit(e) {
    e.preventDefault()
    setUsernameError(null)
    setUsernameSuccess(false)
    const trimmed = newUsername.trim()
    if (!trimmed || trimmed.toLowerCase() === user.username) return
    setUsernameSubmitting(true)
    try {
      const updated = await api.changeUsername(trimmed)
      setUser(updated)
      setNewUsername(updated.username)
      setUsernameSuccess(true)
    } catch (err) {
      setUsernameError(err.message)
    } finally {
      setUsernameSubmitting(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(false)
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.")
      return
    }
    setSubmitting(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const usernameUnchanged = newUsername.trim().toLowerCase() === user?.username

  return (
    <div className="stack">
      <h2>Account settings</h2>

      <form className="card stack" onSubmit={handleUsernameSubmit}>
        <h3 className="dialog-title">Username</h3>

        <label>
          Username
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <p className="muted small">This is what you sign in with.</p>

        {usernameError && <div className="error-text">{usernameError}</div>}
        {usernameSuccess && <p className="net-positive small">Username updated.</p>}

        <button
          type="submit"
          className="primary"
          disabled={usernameSubmitting || !newUsername.trim() || usernameUnchanged}
        >
          {usernameSubmitting ? 'Updating...' : 'Change username'}
        </button>
      </form>

      <form className="card stack" onSubmit={handleSubmit}>
        <h3 className="dialog-title">Change password</h3>

        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        <label>
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>

        {error && <div className="error-text">{error}</div>}
        {success && <p className="net-positive small">Password updated.</p>}

        <button type="submit" className="primary" disabled={submitting || !currentPassword || !newPassword}>
          {submitting ? 'Updating...' : 'Change password'}
        </button>
      </form>
    </div>
  )
}
