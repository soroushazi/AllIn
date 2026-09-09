import { useEffect, useMemo, useRef, useState } from 'react'

// Closes an open suggestion dropdown on any click outside the given
// element - shared by TagEditor and LocationCombobox.
function useCloseOnClickOutside(ref, onClose) {
  useEffect(() => {
    function onMouseDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [ref, onClose])
}

export function TagEditor({ tags, suggestions, onAdd, onRemove }) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  useCloseOnClickOutside(containerRef, () => setOpen(false))

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase()
    if (!q) return []
    return suggestions
      .filter((s) => !tags.some((t) => t.toLowerCase() === s.toLowerCase()))
      .filter((s) => s.toLowerCase().includes(q))
      .slice(0, 8)
  }, [draft, suggestions, tags])

  function commit() {
    const value = draft.trim()
    if (value) onAdd(value)
    setDraft('')
    setOpen(false)
  }

  function selectSuggestion(name) {
    onAdd(name)
    setDraft('')
    setOpen(false)
  }

  return (
    <div className="combobox tag-editor" ref={containerRef}>
      <div className="tag-chips">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            {tag}
            <button type="button" onClick={() => onRemove(tag)} aria-label={`Remove tag ${tag}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
        // Typing a tag and tapping Save/Done without pressing Enter first
        // (easy to do, especially with a mobile keyboard) would otherwise
        // leave it stuck in the draft and silently never added - commit
        // whatever's typed as soon as the field loses focus too.
        onBlur={commit}
        placeholder="Search or add a tag..."
      />
      {open && matches.length > 0 && (
        <ul className="combobox-menu">
          {matches.map((m) => (
            <li key={m}>
              {/* mousedown (not click) is what would otherwise blur the
                  input first and let onBlur's commit() add the raw typed
                  text before this selection runs - preventDefault here
                  keeps focus on the input so only selectSuggestion fires. */}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => selectSuggestion(m)}>
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LocationCombobox({ value, onChange, suggestions }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  useCloseOnClickOutside(containerRef, () => setOpen(false))

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return []
    return suggestions.filter((s) => s.toLowerCase() !== q && s.toLowerCase().includes(q)).slice(0, 8)
  }, [value, suggestions])

  return (
    <div className="combobox location-combobox" ref={containerRef}>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') setOpen(false)
        }}
        placeholder="e.g. Walmart, Trader Joe's"
      />
      {open && matches.length > 0 && (
        <ul className="combobox-menu">
          {matches.map((m) => (
            <li key={m}>
              <button
                type="button"
                onClick={() => {
                  onChange(m)
                  setOpen(false)
                }}
              >
                {m}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
