export default function Voice() {
  return (
    <div className="stack">
      <h2>Voice</h2>
      <div className="card stack">
        <p>Tap-and-talk expense logging is coming soon.</p>
        <p className="muted small">
          The idea: record a quick voice note ("twelve dollars at Starbucks"), it gets transcribed and parsed into a
          draft transaction, and you confirm it before it hits the ledger - never auto-committed.
        </p>
      </div>
    </div>
  )
}
