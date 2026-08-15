import { useEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { HamburgerIcon } from './icons'

const MENU_LINKS = [
  { to: '/account', label: 'Account settings' },
  { to: '/cards', label: 'Cards' },
  { to: '/budgets', label: 'Budgets' },
  { to: '/categories', label: 'Categories' },
]

export default function AccountMenu() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="account-menu" ref={rootRef}>
      <button className="account-menu-trigger" onClick={() => setOpen((o) => !o)} aria-label="Account menu">
        <HamburgerIcon />
      </button>

      {open && (
        <div className="account-menu-dropdown">
          <div className="account-menu-username">{user?.username}</div>
          {MENU_LINKS.map((link) => (
            <NavLink key={link.to} to={link.to} className="account-menu-item" onClick={() => setOpen(false)}>
              {link.label}
            </NavLink>
          ))}
          <button className="account-menu-item danger" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
