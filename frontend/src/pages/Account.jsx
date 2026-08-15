import { useAuth } from '../AuthContext'

export default function Account() {
  const { user } = useAuth()

  return (
    <div className="stack">
      <h2>Account settings</h2>
      <div className="card stack">
        <label>
          Username
          <input type="text" value={user?.username ?? ''} disabled />
        </label>
        <p className="muted small">Changing your name or password is coming soon.</p>
      </div>
    </div>
  )
}
