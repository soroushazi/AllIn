import { useEffect, useState } from 'react'
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
