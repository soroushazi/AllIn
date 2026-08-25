import { NavLink, Outlet } from 'react-router-dom'
import AccountMenu from './AccountMenu'
import { MicIcon } from './icons'

const TABS = [
  { to: '/', label: 'Overview', end: true },
  { to: '/import', label: 'Import' },
  { to: '/voice', label: 'Voice', icon: true },
  { to: '/transactions', label: 'Transactions' },
  { to: '/financial-freedom', label: 'Freedom' },
]

export default function Layout() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/">AllIn</NavLink>
        <AccountMenu />
      </header>

      <main className="page">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        {TABS.map((tab) =>
          tab.icon ? (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) => `nav-voice-button ${isActive ? 'active' : ''}`}
              aria-label={tab.label}
            >
              <MicIcon />
            </NavLink>
          ) : (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              {tab.label}
            </NavLink>
          ),
        )}
      </nav>
    </div>
  )
}
