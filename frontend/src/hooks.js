import { useEffect, useState, useSyncExternalStore } from 'react'
import { api } from './api'

export function useCategories() {
  const [categories, setCategories] = useState([])

  useEffect(() => {
    api.categories.list().then(setCategories).catch(() => {})
  }, [])

  return [categories, setCategories]
}

export function useCards() {
  const [cards, setCards] = useState([])

  useEffect(() => {
    api.cards.list().then(setCards).catch(() => {})
  }, [])

  return [cards, setCards]
}

export function useTags() {
  const [tags, setTags] = useState([])

  useEffect(() => {
    api.tags.list().then(setTags).catch(() => {})
  }, [])

  return [tags, setTags]
}

export function useLocations() {
  const [locations, setLocations] = useState([])

  useEffect(() => {
    api.locations.list().then(setLocations).catch(() => {})
  }, [])

  return [locations, setLocations]
}

// Both household accounts' current {id, username}, ordered by id - a
// stable, rename-safe replacement for hardcoding ['soroush', 'shiva']
// throughout the app. Position 0/1 in this array is a fixed "slot" (see
// UsersView on the backend) usable anywhere a color or internal key needs
// to survive a username change, since id order never changes.
export function useUsers() {
  const [users, setUsers] = useState([])

  useEffect(() => {
    api.users.list().then(setUsers).catch(() => {})
  }, [])

  return [users, setUsers]
}

// The date range picked on Overview or Transactions, shared between the two
// so switching tabs keeps the same range in view (e.g. pick October 2026 on
// Overview, then check its transactions). Deliberately kept in plain module
// memory, not localStorage: it lasts while the app is open and resets to
// Month to date on a full reload or when the app is closed.
let dateFilterState = { dateFilter: 'mtd', customStart: '', customEnd: '' }
const dateFilterListeners = new Set()

function setDateFilterState(patch) {
  dateFilterState = { ...dateFilterState, ...patch }
  dateFilterListeners.forEach((listener) => listener())
}

function subscribeDateFilter(listener) {
  dateFilterListeners.add(listener)
  return () => dateFilterListeners.delete(listener)
}

// Module-level so their identity never changes (safe in effect deps).
const dateFilterSetters = {
  setDateFilter: (dateFilter) => setDateFilterState({ dateFilter }),
  setCustomStart: (customStart) => setDateFilterState({ customStart }),
  setCustomEnd: (customEnd) => setDateFilterState({ customEnd }),
}

export function useSharedDateFilter() {
  const state = useSyncExternalStore(subscribeDateFilter, () => dateFilterState)
  return { ...state, ...dateFilterSetters }
}
