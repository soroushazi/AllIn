import { createContext, useContext, useEffect, useState } from 'react'
import { api } from './api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  // undefined = still checking session, null = logged out, object = logged in
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    let cancelled = false
    async function init() {
      await api.csrf().catch(() => {})
      try {
        const me = await api.me()
        if (!cancelled) setUser(me)
      } catch {
        if (!cancelled) setUser(null)
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [])

  async function login(username, password) {
    const me = await api.login(username, password)
    setUser(me)
  }

  async function logout() {
    await api.logout().catch(() => {})
    setUser(null)
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
