import { useRef, useState, type FormEvent } from 'react'
import type { User } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import {
  emailPasswordLinkEnabled,
  emailPasswordLinkErrorMessage,
  linkEmailPasswordToCurrentAccount,
  needsPasswordSignIn,
} from '../../lib/emailPasswordLink'

// Settings card: lets an existing (typically SMS-only) customer add email +
// password sign-in to THIS account, so they can also sign in to the iDogs
// iPhone app. Same UID → dogs, documents, QR passports and Plus are kept.
export default function EmailPasswordSettings({ user, profileReady, onLinked }: {
  user: User | null
  profileReady: boolean
  onLinked: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ email: string; verificationSent: boolean; emailVerified: boolean } | null>(null)
  const inFlight = useRef(false)

  if (!user || !emailPasswordLinkEnabled()) return null
  if (!done && !needsPasswordSignIn(user)) return null

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!user || inFlight.current || !profileReady) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const result = await linkEmailPasswordToCurrentAccount(user, email, password, confirm)
      if (auth.currentUser?.uid !== result.uid) return
      setPassword(''); setConfirm('')
      setDone({ email: result.email, verificationSent: result.verificationSent, emailVerified: result.emailVerified })
      // A profile refresh failure must not misreport a successful Auth link.
      try { await onLinked() } catch { /* credential is linked; profile reloads later */ }
    } catch (err) {
      setError(emailPasswordLinkErrorMessage(err))
    } finally { inFlight.current = false; setBusy(false) }
  }

  return <section className="card" aria-label="Email and password sign-in" style={{ marginBottom: 16 }}>
    <h2 style={{ fontSize: 17, marginBottom: 10 }}>Email &amp; password sign-in</h2>
    {done ? <div role="status" style={{ fontSize: 14, lineHeight: 1.6 }}>
      <p>You can now sign in with <strong>{done.email}</strong> and your new password, including in the iDogs iPhone app. Your mobile sign-in still works. Your dogs, documents, QR passports and plan are unchanged.</p>
      {!done.emailVerified && <p style={{ fontSize: 13, color: 'var(--mid)' }}>{done.verificationSent ? 'We’ve sent a verification link to this email — open it to confirm the address. Check your Spam or Junk folder too.' : 'We couldn’t send the verification email just now. You can request it again from the email verification page.'}</p>}
    </div> : <>
      <p style={{ fontSize: 13, lineHeight: 1.6 }}>Add an email and password to this account so you can sign in on the iDogs iPhone app or if SMS isn’t available. This keeps your existing account — nothing is moved or merged.</p>
      {!profileReady ? <p role="status">Your account profile is not available. Reload Settings before continuing.</p> :
        <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
          {user.email
            ? <p style={{ fontSize: 13 }}>Email: <strong>{user.email}</strong></p>
            : <label>Email address<input className="form-input" type="email" autoComplete="email" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>}
          <label>New password<input className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
          <label>Confirm password<input className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
          {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Add email sign-in'}</button>
        </form>}
    </>}
  </section>
}
