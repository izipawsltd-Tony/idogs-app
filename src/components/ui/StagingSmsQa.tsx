import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

type QaState = { enabled?: boolean; status?: string; message?: string; recipient?: string; providerMessageId?: string }

export default function StagingSmsQa() {
  const { user, refreshProfile } = useAuth()
  const [qa, setQa] = useState<QaState | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  useEffect(() => {
    let cancelled = false
    setQa(null)
    if (import.meta.env.VITE_FIREBASE_PROJECT_ID !== 'idogs-app-staging' || !user) return
    void (async () => {
      try {
        const token = await user.getIdToken()
        const response = await fetch('/api/staging-sms-qa', { headers: { Authorization: `Bearer ${token}` } })
        if (response.ok) { const state = await response.json(); if (!cancelled) setQa(state) }
      } catch { /* Optional, temporary staging-only control. */ }
    })()
    return () => { cancelled = true }
  }, [user])

  async function sendOnce() {
    if (!user || busy || qa?.status !== 'ready') return
    setBusy(true)
    setQa(state => ({ ...state, status: 'reserved' }))
    try {
      const token = await user.getIdToken()
      const response = await fetch('/api/staging-sms-qa', { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_once' }) })
      const data = await response.json()
      setQa(state => ({ ...state, status: data.status || 'unknown', providerMessageId: data.providerMessageId }))
      setResult(data.message || data.error || 'Outcome unknown. Do not retry.')
      await refreshProfile()
    } catch { setResult('Outcome unknown. Do not retry; check delivery history.') }
    finally { setBusy(false) }
  }

  if (!qa?.enabled) return null
  return <section style={{ marginTop: 16, padding: 14, border: '1px solid var(--border)', borderRadius: 8 }}>
    <h3 style={{ fontSize: 14, marginBottom: 8 }}>Staging SMS QA — one reminder</h3>
    <p style={{ fontSize: 13 }}>{qa.recipient}. One attempt only, using one QA credit.</p>
    <p style={{ fontSize: 13 }}>{qa.message}</p>
    <button className="btn btn-primary btn-sm" disabled={busy || qa.status !== 'ready'} onClick={sendOnce}>
      {busy ? 'Sending…' : qa.status === 'ready' ? 'Send one QA reminder SMS' : 'QA attempt used'}
    </button>
    <p role="status" style={{ fontSize: 13, marginTop: 8 }}>{result || `Status: ${qa.status}`}</p>
    {qa.providerMessageId && <p style={{ fontSize: 12 }}>ClickSend message ID: {qa.providerMessageId}</p>}
  </section>
}
