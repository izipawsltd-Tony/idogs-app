import { useEffect, useRef, useState, type FormEvent } from 'react'
import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import type { User } from 'firebase/auth'

export default function QaVerificationInbox({ user }: { user: User | null }) {
  const [messages, setMessages] = useState<{ label: string; url: string }[]>([])
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false)
  const [resetCode, setResetCode] = useState(''), [resetPassword, setResetPassword] = useState(''), [resetComplete, setResetComplete] = useState(false)
  const generation = useRef(0), pending = useRef<AbortController | null>(null)
  const enabled = import.meta.env.DEV && import.meta.env.VITE_ACCOUNT_ONBOARDING_QA === '1' && import.meta.env.VITE_FIREBASE_PROJECT_ID === 'demo-idogs-account-onboarding'
  useEffect(() => { generation.current++; setMessages([]); setLoaded(false); setError(''); setBusy(false); setResetCode(''); setResetPassword(''); setResetComplete(false); return () => { generation.current++; pending.current?.abort() } }, [user?.uid])
  if (!enabled || !user) return null
  async function openInbox() {
    if (!user || busy) return
    const current = generation.current
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller
    setBusy(true); setError('')
    try {
      const token = await user.getIdToken(true)
      const response = await fetch('/api/qa-onboarding/mailbox', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error()
      const data = await response.json()
      if (!Array.isArray(data.messages)) throw new Error()
      const safe: { label: string; url: string }[] = (data.messages as { label?: unknown; url?: unknown }[]).filter((message): message is { label: string; url: string } => {
        if (!['Verify test email', 'Reset test password'].includes(String(message.label)) || typeof message.url !== 'string') return false
        try { const url = new URL(message.url); return url.origin === 'http://127.0.0.1:9399' && !url.username && !url.password && url.pathname === '/emulator/action' && url.searchParams.get('mode') === (message.label === 'Reset test password' ? 'resetPassword' : 'verifyEmail') && !!url.searchParams.get('oobCode') } catch { return false }
      })
      if (generation.current === current && !controller.signal.aborted) { setMessages(safe.filter(message => message.label === 'Verify test email').slice(-1).concat(safe.filter(message => message.label === 'Reset test password').slice(-1))); setLoaded(true) }
    } catch { if (generation.current === current && !controller.signal.aborted) setError('Could not open the test inbox. Try again, or request another verification email.') }
    finally { if (generation.current === current) setBusy(false) }
  }
  async function saveTestPassword(event: FormEvent) {
    event.preventDefault()
    if (!enabled || !user || !resetCode || resetPassword.length < 8 || busy) return
    const uid = user.uid
    const code = resetCode
    const proposedPassword = resetPassword
    setBusy(true); setError('')
    try {
      // The code must belong to the currently authenticated synthetic UID.
      const codeEmail = await verifyPasswordResetCode(auth, code)
      if (auth.currentUser?.uid !== uid || !user.email || codeEmail.toLowerCase() !== user.email.toLowerCase()) {
        throw new Error('QA_ACCOUNT_MISMATCH')
      }
      await confirmPasswordReset(auth, code, proposedPassword)
      if (auth.currentUser?.uid !== uid) throw new Error('QA_ACCOUNT_CHANGED')
      setResetComplete(true); setResetCode(''); setResetPassword('')
    } catch {
      setError('Could not reset this test password. Request a fresh reset link for the same signed-in QA account and try again.')
      setResetCode(''); setResetPassword('')
    } finally { setBusy(false) }
  }
  return <section role="note" style={{ width: '100%', boxSizing: 'border-box', background: '#f3f8f2', border: '1px solid #dce8db', borderRadius: 12, padding: 16, marginTop: 18, textAlign: 'left' }} aria-label="Simulated verification inbox">
    <strong>Local QA: no email is sent to Gmail</strong>
    <p style={{ fontSize: 13, lineHeight: 1.6, margin: '8px 0 12px' }}>Open the simulated inbox below. Choose Verify test email to complete verification, or Reset test password after requesting a reset link. No real Gmail is sent.</p>
    <button type="button" className="btn btn-secondary" style={{ width: '100%', whiteSpace: 'normal' }} disabled={busy} onClick={() => void openInbox()}>{busy ? 'Opening test inbox…' : 'Open verification email (simulated)'}</button>
    {error && <p role="alert" style={{ fontSize: 13, marginTop: 12 }}>{error}</p>}
    {loaded && !messages.length && <p role="status" style={{ fontSize: 13, marginTop: 12 }}>No test message yet. Request a verification or password reset link, then open this inbox again.</p>}
    {messages.map((message, index) => <p key={index} style={{ margin: '12px 0 0' }}>{message.label === 'Reset test password'
      ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setError(''); setResetComplete(false); setResetCode(new URL(message.url).searchParams.get('oobCode') || '') }}>{message.label}</button>
      : <a className="btn btn-primary" href={message.url} target="_blank" rel="noreferrer">{message.label}</a>}</p>)}
    {resetCode && !resetComplete && <form onSubmit={event => void saveTestPassword(event)} style={{ marginTop: 12 }}>
      <label htmlFor="qa-new-password">New QA password (8+ characters)</label>
      <input id="qa-new-password" className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={resetPassword} onChange={event => setResetPassword(event.target.value)} />
      <button type="submit" className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy || resetPassword.length < 8}>{busy ? 'Saving…' : 'Save test password'}</button>
    </form>}
    {resetComplete && <p role="status">Test password saved. Return to your account setup screen to confirm it, or sign in with the same email and your new password.</p>}
  </section>
}
