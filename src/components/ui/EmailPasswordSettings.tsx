import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { safeAppReturnTo } from '../../lib/returnTo'
import {
  addPasswordToVerifiedEmail,
  completeAddEmailLink,
  emailPasswordLinkEnabled,
  emailPasswordLinkErrorMessage,
  emailPasswordStep,
  isAddEmailLink,
  sendAddEmailLink,
} from '../../lib/emailPasswordLink'

// Settings card: lets an existing (typically SMS-only) customer add email +
// password sign-in to THIS account, so they can also sign in to the iDogs
// iPhone app. The email is always verified before a password is set, and
// everything stays on the same UID → dogs, documents, QR passports and Plus
// are kept. See src/lib/emailPasswordLink.ts.
export default function EmailPasswordSettings({ user, profileReady, onLinked, href = typeof window !== 'undefined' ? window.location.href : '' }: {
  user: User | null
  profileReady: boolean
  onLinked: () => Promise<void>
  href?: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null)
  const [emailJustLinked, setEmailJustLinked] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const inFlight = useRef(false)
  const linkHandled = useRef(false)
  // Where the customer was going before being asked for an email (/verify-email).
  const [continueTo] = useState(() => { try { const n = new URL(href).searchParams.get('next'); return n ? safeAppReturnTo(n) : null } catch { return null } })

  // Returning from the emailed link: attach the verified address to this uid.
  useEffect(() => {
    if (!user || !profileReady || linkHandled.current || !emailPasswordLinkEnabled() || !isAddEmailLink(href)) return
    linkHandled.current = true
    inFlight.current = true; setBusy(true); setError('')
    completeAddEmailLink(user, href)
      .then(async result => {
        if (auth.currentUser?.uid !== result.uid) return
        setEmailJustLinked(result.email)
        try { await onLinked() } catch { /* linked; profile reloads later */ }
      })
      .catch(err => setError(emailPasswordLinkErrorMessage(err)))
      .finally(() => {
        inFlight.current = false; setBusy(false)
        // Never leave the one-time code in the address bar or history.
        try { window.history.replaceState(null, '', '/app/settings') } catch { /* non-browser */ }
      })
  }, [user, profileReady, href, onLinked])

  if (!user || !emailPasswordLinkEnabled()) return null
  const step = emailJustLinked ? 'set-password' : emailPasswordStep(user)
  if (!done && !error && step === 'hidden' && !busy) return null

  async function run(action: () => Promise<void>) {
    if (inFlight.current || !profileReady) return
    inFlight.current = true; setBusy(true); setError('')
    try { await action() } catch (err) { setError(emailPasswordLinkErrorMessage(err)) } finally { inFlight.current = false; setBusy(false) }
  }
  function sendLink(event: FormEvent) {
    event.preventDefault()
    void run(async () => { const r = await sendAddEmailLink(user!, email, window.location.origin); setLinkSentTo(r.email) })
  }
  function setNewPassword(event: FormEvent) {
    event.preventDefault()
    void run(async () => {
      const result = await addPasswordToVerifiedEmail(user!, password, confirm, { allowEmailLinkProvider: !!emailJustLinked })
      if (auth.currentUser?.uid !== result.uid) return
      setPassword(''); setConfirm(''); setDone(result.email)
      try { await onLinked() } catch { /* password is set; profile reloads later */ }
    })
  }

  return <section className="card" aria-label="Email and password sign-in" style={{ marginBottom: 16 }}>
    <h2 style={{ fontSize: 17, marginBottom: 10 }}>Email &amp; password sign-in</h2>
    {done ? <div role="status" style={{ fontSize: 14, lineHeight: 1.6 }}>
      <p>You can now sign in with <strong>{done}</strong> and your new password, including in the iDogs iPhone app. Your mobile sign-in still works. Your dogs, documents, QR passports and plan are unchanged.</p>
      {continueTo && <Link className="btn btn-primary" to={continueTo}>Continue</Link>}
    </div> : <>
      <p style={{ fontSize: 13, lineHeight: 1.6 }}>Add an email and password to this account so you can sign in on the iDogs iPhone app or if SMS isn’t available. This keeps your existing account — nothing is moved or merged.</p>
      {!profileReady ? <p role="status">Your account profile is not available. Reload Settings before continuing.</p>
        : busy && !linkSentTo && step !== 'set-password' ? <p role="status">Please wait…</p>
        : step === 'add-email' ? (linkSentTo
          ? <div role="status" data-testid="email-link-sent" style={{ fontSize: 13, lineHeight: 1.6 }}>
              <p><strong>Step 1 of 2:</strong> we sent a link to <strong>{linkSentTo}</strong>. Open it on this device while signed in. The email is only added after you open the link. Check Spam or Junk too.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setLinkSentTo(null)}>Use a different email</button>
            </div>
          : <form onSubmit={sendLink} style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
              <p style={{ fontSize: 13 }}><strong>Step 1 of 2:</strong> confirm your email address.</p>
              <label>Email address<input className="form-input" type="email" autoComplete="email" required disabled={busy} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
              {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Email me a confirmation link'}</button>
            </form>)
        : step === 'verify-email' ? <div data-testid="email-password-verify-step" style={{ fontSize: 13, lineHeight: 1.6 }}>
            <p><strong>Step 1 of 2:</strong> verify <strong>{user.email}</strong>.</p>
            <Link className="btn btn-primary" to="/verify-email?next=%2Fapp%2Fsettings">Verify email</Link>
            <p style={{ marginTop: 8, color: 'var(--mid)' }}>Then come back here for step 2: choose a password.</p>
          </div>
        : step === 'set-password' ? <form onSubmit={setNewPassword} style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
            {emailJustLinked && <p role="status" style={{ fontSize: 13, color: 'var(--green)' }}>Email added and verified: <strong>{emailJustLinked}</strong>.{continueTo && <> <Link to={continueTo}>Continue where you left off</Link> — or set a password first.</>}</p>}
            <p style={{ fontSize: 13 }}><strong>Step 2 of 2:</strong> choose a password for <strong>{emailJustLinked || user.email}</strong> (verified).</p>
            <label>New password<input className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
            <label>Confirm password<input className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)} /></label>
            {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Set password'}</button>
          </form>
        : error ? <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}
    </>}
  </section>
}
