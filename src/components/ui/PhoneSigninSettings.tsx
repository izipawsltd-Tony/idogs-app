import { useEffect, useRef, useState, type FormEvent } from 'react'
import { EmailAuthProvider, PhoneAuthProvider, reauthenticateWithCredential, RecaptchaVerifier, updatePhoneNumber, type User } from 'firebase/auth'
import { auth } from '../../lib/firebase'
import { normalizeSigninPhone } from '../../lib/passwordless'

export default function PhoneSigninSettings({ user, profileReady, onLinked }: { user: User | null; profileReady: boolean; onLinked: () => Promise<void> }) {
  const [phone, setPhone] = useState(''), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState(''), [linked, setLinked] = useState(user?.phoneNumber || '')
  const [available, setAvailable] = useState<boolean | null>(null), [retry, setRetry] = useState(0)
  const [cooldown, setCooldown] = useState(0)
  const [password, setPassword] = useState(''), [editing, setEditing] = useState(false)
  const captcha = useRef<RecaptchaVerifier | null>(null), captchaNode = useRef<HTMLDivElement>(null), confirmation = useRef<{ id: string; phone: string; uid: string; expires: number } | null>(null), inFlight = useRef(false)
  useEffect(() => {
    let live = true
    if (user?.emailVerified && profileReady && editing) {
      setAvailable(null)
      fetch('/api/auth-options').then(r => { if (!r.ok) throw new Error(); return r.json() }).then(data => { if (live) setAvailable(data.phone === true) }).catch(() => { if (live) setAvailable(false) })
    }
    return () => { live = false; captcha.current?.clear() }
  }, [user?.uid, user?.emailVerified, profileReady, editing, retry])
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(v => Math.max(0, v - 1)), 1000); return () => clearTimeout(timer) }, [cooldown])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || !user?.email || !user.emailVerified || !profileReady || !available || (!confirmation.current && cooldown > 0)) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (auth.currentUser?.uid !== user.uid) throw new Error('session-changed')
      if (confirmation.current) {
        const pending = confirmation.current
        if (pending.uid !== user.uid || Date.now() > pending.expires) throw new Error('session-expired')
        if (!/^\d{6}$/.test(code)) throw new Error('invalid-verification-code')
        // Update this UID only. Do not sign in, create users or unlink the old number first.
        await updatePhoneNumber(user, PhoneAuthProvider.credential(pending.id, code))
        if (auth.currentUser?.uid !== user.uid) throw new Error('session-changed')
        setLinked(pending.phone); confirmation.current = null; setSent(false); setCode(''); setEditing(false)
        // A profile-refresh failure must not misreport a successful Auth link.
        try { await onLinked() } catch { /* The confirmed linked number remains visible. */ }
      } else {
        if (!captchaNode.current) throw new Error('Please retry the security check.')
        const number = normalizeSigninPhone(phone)
        if (number === linked) throw new Error('Choose a different mobile number.')
        if (!password) throw new Error('Enter your current email password first.')
        const result = await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password))
        setPassword('')
        if (result.user.uid !== user.uid || auth.currentUser?.uid !== user.uid) throw new Error('session-changed')
        captcha.current?.clear()
        captcha.current = new RecaptchaVerifier(auth, captchaNode.current, { size: 'invisible' })
        const id = await new PhoneAuthProvider(auth).verifyPhoneNumber(number, captcha.current)
        if (auth.currentUser?.uid !== user.uid) throw new Error('session-changed')
        confirmation.current = { id, phone: number, uid: user.uid, expires: Date.now() + 5 * 60 * 1000 }
        setSent(true); setCooldown(60)
      }
    } catch (err) {
      setPassword('')
      const message = err instanceof Error ? err.message : ''
      setError(/credential-already-in-use|phone-number-already-exists|account-exists-with-different-credential/.test(message) ? 'This number is already linked to a different account. Use email for your other accounts; no accounts or dog records have been merged.' : /wrong-password|invalid-credential|invalid-login-credentials/.test(message) ? 'Your email password could not be confirmed. Try again or reset your password.' : message.includes('invalid-verification-code') ? 'That code is not correct. Please try again.' : /requires-recent-login|session-changed|user-token-expired/.test(message) ? 'Please sign in to this account again, then return to Settings.' : /code-expired|session-expired/.test(message) ? 'The code has expired. Choose Start again to confirm your password and request a new code.' : /captcha|invalid-app-credential/.test(message) ? 'The browser security check could not finish. Please try again in Safari or Chrome.' : message.startsWith('Firebase:') || message.startsWith('auth/') ? 'Could not update this number. Check the number and try again shortly.' : message || 'Could not update this number. Please retry.')
    } finally { inFlight.current = false; setBusy(false) }
  }
  if (!user) return null
  return <section className="card" aria-label="Account mobile number" style={{ marginBottom: 16 }}>
    <h2 style={{ fontSize: 17, marginBottom: 10 }}>Account mobile number</h2>
    <p style={{ fontSize: 13, lineHeight: 1.6 }}>Use email and password as your main sign-in. Link one mobile number to one primary account. Other accounts use their own email. Your contact phone does not link accounts.</p>
    {linked && <p role="status">Linked mobile: <strong>{linked}</strong>. Your dogs, records and subscription stay with this account.</p>}
    {!profileReady ? <p role="status">Your account profile is not available. Reload Settings before linking a number.</p> : !user.email || !user.emailVerified ? <p><a href="/verify-email?next=%2Fapp%2Fsettings">Add and verify your email first</a> so you can recover this account.</p> : !editing ? <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>{linked ? 'Change mobile number' : 'Link mobile number'}</button> : <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 440 }}>
      <p style={{ fontSize: 13 }}>Confirm your email password for <strong>{user.email}</strong>, then verify your mobile. {linked && 'Your current number stays linked until the new number is verified.'}</p>
      {!sent ? <><label>Current password<input className="form-input" type="password" autoComplete="current-password" required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label><label>{linked ? 'New mobile number' : 'Mobile number'}<input className="form-input" type="tel" autoComplete="tel" placeholder="04xx xxx xxx or +61…" required disabled={busy} value={phone} onChange={e => setPhone(e.target.value)} /></label><a href="/forgot-password">Forgot password?</a></> : <><p role="status">Enter the code sent to {phone}.</p><label>Verification code<input className="form-input" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={busy} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { confirmation.current = null; setSent(false); setCode(''); setPassword(''); setError(''); captcha.current?.clear() }}>Start again</button></>}
      <p style={{ fontSize: 12 }}>We’ll send a verification code by SMS. Google stores and processes phone numbers to help prevent spam and abuse. This does not subscribe you to promotional SMS.</p>
      {error && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error} <a href="/login?next=%2Fapp%2Fsettings">Sign in with email</a></p>}
      {available === false && <p role="alert">SMS linking is unavailable. <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry(v => v + 1)}>Retry</button></p>}
      <div ref={captchaNode} />
      <button className="btn btn-primary" disabled={busy || available !== true || (!sent && cooldown > 0)} type="submit">{busy ? 'Please wait…' : available === null ? 'Checking SMS availability…' : sent ? 'Verify and save mobile' : cooldown ? `Send another code in ${cooldown}s` : 'Confirm password and send code'}</button>
      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { confirmation.current = null; setSent(false); setCode(''); setPassword(''); setError(''); setEditing(false) }}>Cancel</button>
    </form>}
  </section>
}
