import { useEffect, useRef, useState, type FormEvent } from 'react'
import { linkWithPhoneNumber, RecaptchaVerifier, type ConfirmationResult, type User } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { normalizeSigninPhone } from '../../lib/passwordless'

export default function PhoneSigninSettings({ user, profileReady, onLinked }: { user: User | null; profileReady: boolean; onLinked: () => Promise<void> }) {
  const [phone, setPhone] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState(''), [linked, setLinked] = useState(user?.phoneNumber || '')
  const [available, setAvailable] = useState<boolean | null>(null), [retry, setRetry] = useState(0)
  const [cooldown, setCooldown] = useState(0)
  const captcha = useRef<RecaptchaVerifier | null>(null), captchaNode = useRef<HTMLDivElement>(null), confirmation = useRef<ConfirmationResult | null>(null), inFlight = useRef(false)
  useEffect(() => {
    let live = true
    if (user?.emailVerified && profileReady && !user.phoneNumber) {
      setAvailable(null)
      fetch('/api/auth-options').then(r => { if (!r.ok) throw new Error(); return r.json() }).then(data => { if (live) setAvailable(data.phone === true) }).catch(() => { if (live) setAvailable(false) })
    }
    return () => { live = false; captcha.current?.clear() }
  }, [user?.uid, user?.emailVerified, user?.phoneNumber, profileReady, retry])
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(v => Math.max(0, v - 1)), 1000); return () => clearTimeout(timer) }, [cooldown])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || !user?.email || !user.emailVerified || !profileReady || !available || (!confirmation.current && cooldown > 0)) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (auth.currentUser?.uid !== user.uid) throw new Error('session-changed')
      if (confirmation.current) {
        const result = await confirmation.current.confirm(code)
        if (result.user.uid !== user.uid) throw new Error('session-changed')
        setLinked(result.user.phoneNumber || normalizeSigninPhone(phone))
        // A profile-refresh failure must not misreport a successful Auth link.
        try { await onLinked() } catch { /* The confirmed linked number remains visible. */ }
      } else {
        if (!captchaNode.current) throw new Error('Please retry the security check.')
        const number = normalizeSigninPhone(phone)
        captcha.current?.clear()
        captcha.current = new RecaptchaVerifier(auth, captchaNode.current, { size: 'invisible' })
        // Link a provider to THIS identity. Never sign in/create another identity here.
        confirmation.current = await linkWithPhoneNumber(user, number, captcha.current)
        setSent(true); setCooldown(60)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      setError(/credential-already-in-use|phone-number-already-exists|account-exists-with-different-credential/.test(message) ? 'This number is already linked to a different sign-in account. Use email to access your existing accounts. Contact iDogs to review which account should keep SMS sign-in; no accounts or dog records have been merged.' : message.includes('invalid-verification-code') ? 'That code is not correct. Please try again.' : /requires-recent-login|session-changed|user-token-expired/.test(message) ? 'Please sign in to this account again, then return to Settings to link your mobile number.' : /code-expired|session-expired/.test(message) ? 'The code has expired. Choose Change number and request a new code.' : /captcha|invalid-app-credential/.test(message) ? 'The browser security check could not finish. Please try again in Safari or Chrome.' : message.startsWith('Firebase:') || message.startsWith('auth/') ? 'Could not link this number. Check the number and try again shortly.' : message || 'Could not link this number. Please retry.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  if (!user) return null
  return <section className="card" aria-label="Mobile sign-in" style={{ marginBottom: 16 }}>
    <h2 style={{ fontSize: 17, marginBottom: 10 }}>Mobile sign-in</h2>
    <p style={{ fontSize: 13, lineHeight: 1.6 }}>One mobile number can sign in to one primary iDogs account. Other accounts use their own email and password. Your contact phone can be shared across profiles; it does not enable SMS sign-in.</p>
    {linked ? <p role="status">SMS sign-in is linked to <strong>{linked}</strong> for this account. Your dogs and records stay with this account.</p> : !profileReady ? <p role="status">Your account profile is not available. Reload Settings before linking a number.</p> : !user.email || !user.emailVerified ? <p><a href="/verify-email?next=%2Fapp%2Fsettings">Add and verify your email first</a> so you can recover this account.</p> : <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
      <p style={{ fontSize: 13 }}>Link SMS sign-in to this account: <strong>{user.email}</strong>. This keeps your existing profile and records.</p>
      {!sent ? <label>Mobile number<input className="form-input" type="tel" autoComplete="tel" placeholder="04xx xxx xxx or +61…" required disabled={busy} value={phone} onChange={e => setPhone(e.target.value)} /></label> : <><p role="status">Enter the code sent to {phone}.</p><label>Verification code<input className="form-input" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={busy} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { confirmation.current = null; setSent(false); setCode(''); setError(''); captcha.current?.clear() }}>Change number</button></>}
      <p style={{ fontSize: 12 }}>We’ll send a verification code by SMS. Google stores and processes phone numbers to help prevent spam and abuse. This does not subscribe you to promotional SMS.</p>
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error} <a href="/login?next=%2Fapp%2Fsettings">Sign in with email</a></p>}
      {available === false && <p role="alert">SMS linking is unavailable. <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry(v => v + 1)}>Retry</button></p>}
      <div ref={captchaNode} />
      <button className="btn btn-primary" disabled={busy || available !== true || (!sent && cooldown > 0)} type="submit">{busy ? 'Please wait…' : available === null ? 'Checking SMS availability…' : sent ? 'Verify and link mobile' : cooldown ? `Send another code in ${cooldown}s` : 'Send verification code'}</button>
    </form>}
  </section>
}
