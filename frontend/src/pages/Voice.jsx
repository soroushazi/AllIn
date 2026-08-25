import { useRef, useState } from 'react'
import { api } from '../api'
import { useCards, useCategories, useLocations, useTags } from '../hooks'
import AddTransactionForm from '../AddTransactionForm'
import { MicIcon } from '../icons'

// Whatever MediaRecorder can actually produce - Safari/iOS doesn't support
// webm, so this is the detail that makes recording work in an installed iOS
// PWA (see CLAUDE.md Stack notes: MediaRecorder works from iOS 14.3+, but
// only with formats Safari itself supports).
function pickMimeType() {
  const candidates = ['audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg']
  return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || ''
}

export default function Voice() {
  const [cards] = useCards()
  const [categories] = useCategories()
  const [tags, setTags] = useTags()
  const [locations, setLocations] = useLocations()

  const [status, setStatus] = useState('idle') // idle | recording | processing | draft | error
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null) // { transcript, amount, description, location, notes, category_id, owner, card_id }
  const [justAdded, setJustAdded] = useState(null)

  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])

  async function startRecording() {
    setError(null)
    setJustAdded(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
        handleRecordingComplete(new Blob(chunksRef.current, { type: mimeType || 'audio/webm' }))
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setStatus('recording')
    } catch {
      setError("Couldn't access the microphone - check the browser/PWA has permission and try again.")
      setStatus('error')
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop()
  }

  async function handleRecordingComplete(blob) {
    setStatus('processing')
    try {
      const formData = new FormData()
      formData.append('audio', blob, 'voice-note.webm')
      const result = await api.voice.capture(formData)
      setDraft(result)
      setStatus('draft')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  function handleAdded(created) {
    setJustAdded(created)
    setDraft(null)
    setStatus('idle')
    api.tags.list().then(setTags).catch(() => {})
    api.locations.list().then(setLocations).catch(() => {})
  }

  function discardDraft() {
    setDraft(null)
    setStatus('idle')
  }

  // The LLM's owner guess narrows which cards are offered even when no
  // specific card was confidently resolved (draft.card_id) - see
  // resolve_card in services.py, which only returns a card when it's an
  // unambiguous match, same never-guess spirit as category resolution.
  const cardOptions = draft?.owner ? cards.filter((c) => c.owner === draft.owner) : cards

  return (
    <div className="stack">
      <h2>Voice</h2>

      {(status === 'idle' || status === 'error') && (
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <p className="muted small">Tap the mic, say what you spent, tap again to stop.</p>
          <button type="button" className="voice-record-button" onClick={startRecording} aria-label="Start recording">
            <MicIcon />
          </button>
          {error && <div className="error-text">{error}</div>}
        </div>
      )}

      {status === 'recording' && (
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <p>Listening...</p>
          <button
            type="button"
            className="voice-record-button recording"
            onClick={stopRecording}
            aria-label="Stop recording"
          >
            <MicIcon />
          </button>
        </div>
      )}

      {status === 'processing' && (
        <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <p className="muted">Transcribing and parsing...</p>
        </div>
      )}

      {status === 'draft' && draft && (
        <div className="stack">
          <div className="card stack">
            <p className="muted small">Heard:</p>
            <p>"{draft.transcript || '(nothing recognized)'}"</p>
            <p className="muted small">
              Review and fill in anything missing below, then add it - nothing is saved yet.{' '}
              <button type="button" className="link-button" onClick={discardDraft}>
                Discard
              </button>
            </p>
          </div>

          <AddTransactionForm
            cards={cardOptions}
            categories={categories}
            locationSuggestions={locations}
            tagSuggestions={tags.map((t) => t.name)}
            onAdded={handleAdded}
            source="voice"
            initialValues={{
              description: draft.description || '',
              amount: draft.amount != null ? Math.abs(Number(draft.amount)).toFixed(2) : '',
              categoryId: draft.category_id || '',
              notes: draft.notes || '',
              location: draft.location || '',
              cardId: draft.card_id ? String(draft.card_id) : '',
            }}
          />
        </div>
      )}

      {justAdded && (
        <div className="card stack">
          <p>
            Added <strong>{justAdded.description}</strong> - ${Math.abs(Number(justAdded.amount)).toFixed(2)}
          </p>
        </div>
      )}
    </div>
  )
}
