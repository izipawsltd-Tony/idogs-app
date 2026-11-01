import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import {
  addPasswordToVerifiedEmail,
  emailPasswordLinkEnabled,
  emailPasswordLinkErrorMessage,
  emailPasswordStep,
} from '../../lib/emailPasswordLink'

// Settings card: lets an existing (typically SMS-only) customer add email +
// password sign-in to THIS account, so they can also sign in to the iDogs
// iPhone app. Step 1 verifies the email (existing /verify-email flow, which
// only attaches the address after its owner clicks the link). Step 2 sets a
// password on the same UID → dogs, documents, QR passports and Plus are kept.
export default function EmailPasswordSettings({ user, profileReady, onLinked }: {
  user: User | null
  profileReady: boolean
  onLinked: () => Promise<void>
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)
  const inFlight = useRef(false)

  if (!user || !emailPasswordLinkEnabled()) return null
  const step = emailPasswordStep(user)
  if (!done && step === 'hidden') return null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!user || inFlight.current || !profileReady) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const result = await addPasswordToVerifiedEmail(user, password, confirm)
      if (auth.currentUser?.uid !== result.uid) return
      setPassword(''); setConfirm('')
      setDone(result.email)
      // A profile refresh failure must not misreport a successful password set.
      try { await onLinked() } catch { /* password is set; profile reloads later */ }
    } catch (err) {
      setError(emailPasswordLinkErrorMessage(err))
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <section className="card" aria-label="Email and password sign-in" style={{ marginBottom: 16 }}>
    <h2 style={{ fontSize: 17, marginBottom: 10 }}>Email &amp; password sign-in</h2>
    {done ? <div role="status" style={{ fontSize: 14, lineHeight: 1.6 }}>
      <p>You can now sign in with <strong>{done}</strong> and your new password, including in the iDogs iPhone app. Your mobile sign-in still works. Your dogs, documents, QR passports and plan are unchanged.</p>
    </div> : <>
      <p style={{ fontSize: 13, lineHeight: 1.6 }}>Add an email and password to this account so you can sign in on the iDogs iPhone app or if SMS isn’t available. This keeps your existing account — nothing is moved or merged.</p>
      {!profileReady ? <p role="status">Your account profile is not available. Reload Settings before continuing.</p>
        : step === 'verify-email' ? <div data-testid="email-password-verify-step" style={{ fontSize: 13, lineHeight: 1.6 }}>
          <p><strong>Step 1 of 2:</strong> {user.email ? <>verify <strong>{user.email}</strong></> : 'add and verify your email address'}. We’ll send a link — the email is only added after you open it.</p>
          <Link className="btn btn-primary" to="/verify-email?next=%2Fapp%2Fsettings">{user.email ? 'Verify email' : 'Add email'}</Link>
          <p style={{ marginTop: 8, color: 'var(--mid)' }}>Then come back here for step 2: choose a password.</p>
        </div>
        : <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
          <p style={{ fontSize: 13 }}><strong>Step 2 of 2:</strong> choose a password for <strong>{user.email}</strong> (verified).</p>
          <label>New password<input className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Confirm password<input className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
          {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Set password'}</button>
        </form>}
    </>}
  </section>
}
