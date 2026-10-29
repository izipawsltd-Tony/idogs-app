import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getAdditionalUserInfo, RecaptchaVerifier, sendSignInLinkToEmail, signInWithPhoneNumber, type ConfirmationResult, type UserCredential } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { auth } from '../../lib/firebase'
import { emailReturnUrl, normalizeSigninPhone, PENDING_SIGNIN_PREFIX } from '../../lib/passwordless'
import { useAuth } from '../../hooks/useAuth'
import { trackCompletedRegistration } from '../../lib/metaPixel'

export default function PasswordlessSignIn({ next, signup = false }: { next: string; signup?: boolean }) {
  const navigate = useNavigate(), { finishQuickSignIn } = useAuth()
  const [method, setMethod] = useState<'email' | 'phone'>('email'), [name, setName] = useState(''), [email, setEmail] = useState(''), [phone, setPhone] = useState(''), [code, setCode] = useState(''), [marketing, setMarketing] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [sent, setSent] = useState(false), [cooldown, setCooldown] = useState(0)
  const [options, setOptions] = useState<{ emailLink?: boolean; phone?: boolean; phoneTestOnly?: boolean }>({})
  const captcha = useRef<RecaptchaVerifier | null>(null), captchaElement = useRef<HTMLDivElement>(null), confirmation = useRef<ConfirmationResult | null>(null), completed = useRef<UserCredential | null>(null)
  useEffect(() => { let live = true; fetch('/api/auth-options').then(r => r.json()).then(data => { if (live) setOptions(data) }).catch(() => {}); return () => { live = false; captcha.current?.clear() } }, [])
  useEffect(() => { if (!cooldown) return; const t = setTimeout(() => setCooldown(v => Math.max(0, v - 1)), 1000); return () => clearTimeout(t) }, [cooldown])
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('')
    try {
      if (method === 'email') {
        if (!options.emailLink) throw new Error('Email link sign-in is not available yet. Please use Google or your existing password.')
        const flow = crypto.randomUUID(), key = PENDING_SIGNIN_PREFIX + flow
        // Store contact details locally, never in the emailed URL.
        try { localStorage.setItem(key, JSON.stringify({ email: email.trim(), name: name.trim(), marketingOptIn: marketing, createdAt: Date.now() })) } catch { /* Other-device completion asks for email again. */ }
        await sendSignInLinkToEmail(auth, email.trim(), { url: emailReturnUrl(location.origin, next, flow), handleCodeInApp: true })
        setSent(true); setCooldown(60)
      } else if (confirmation.current || completed.current) {
        const result = completed.current || await confirmation.current!.confirm(code)
        completed.current = result
        const isNew = getAdditionalUserInfo(result)?.isNewUser === true
        await finishQuickSignIn(result.user, isNew, name, marketing)
        if (isNew) trackCompletedRegistration()
        navigate(next, { replace: true })
      } else {
        if (!options.phone) throw new Error('Phone sign-in is not available yet. Please use email or Google.')
        const number = normalizeSigninPhone(phone)
        captcha.current?.clear()
        if (!captchaElement.current) throw new Error('Please try again.')
        captcha.current = new RecaptchaVerifier(auth, captchaElement.current, { size: 'invisible' })
        confirmation.current = await signInWithPhoneNumber(auth, number, captcha.current)
        setSent(true); setCooldown(60)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(msg.includes('invalid-verification-code') ? 'That code is not correct. Please try again.' : msg.includes('code-expired') || msg.includes('session-expired') ? 'That code has expired. Choose another method, then request a new code.' : msg.includes('too-many-requests') || msg.includes('quota-exceeded') ? 'Too many requests. Please wait and try again, or use Google.' : msg.startsWith('Firebase:') ? 'Could not continue. Please try again or choose another sign-in method.' : msg || 'Could not continue. Please try again.')
    } finally { setBusy(false) }
  }
  function changeMethod(value: 'email' | 'phone') { if (busy) return; setMethod(value); setSent(false); setError(''); setCode(''); confirmation.current = null; completed.current = null; captcha.current?.clear(); captcha.current = null }
  return <div>
    <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px' }}><button type="button" className={method === 'email' ? 'btn btn-primary' : 'btn btn-secondary'} aria-pressed={method === 'email'} disabled={busy} onClick={() => changeMethod('email')}>Email</button><button type="button" className={method === 'phone' ? 'btn btn-primary' : 'btn btn-secondary'} aria-pressed={method === 'phone'} disabled={busy} onClick={() => changeMethod('phone')}>Mobile number</button></div>
    <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
      {signup && !sent && <label>Your name<input className="form-input" autoComplete="name" value={name} onChange={e => setName(e.target.value)} maxLength={120} placeholder="What should we call you?" disabled={busy} /></label>}
      {method === 'email' ? <><label>Email address<input className="form-input" type="email" autoComplete="email" value={email} onChange={e => { setEmail(e.target.value); setSent(false) }} required disabled={busy} placeholder="you@example.com" /></label>{sent && <p role="status">Check your inbox for your sign-in link. Open it to continue — no password needed. Check your junk folder too.</p>}</> : <>{!sent ? <label>Mobile number<input className="form-input" type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} required disabled={busy} placeholder="04xx xxx xxx or +61…" /></label> : <><p role="status">Enter the code for {phone}.</p><label>Verification code<input className="form-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} required disabled={busy} /></label><button type="button" className="btn btn-secondary" disabled={busy || cooldown > 0} onClick={() => changeMethod('phone')}>{cooldown ? `Request another code in ${cooldown}s` : 'Change number or request another code'}</button></>}
      <p style={{ fontSize: 12 }}>{options.phoneTestOnly ? 'QA testing only: use the test number supplied by iDogs. No real SMS is sent.' : 'We’ll send a sign-in code by SMS. Google stores and processes phone numbers to help prevent spam and abuse.'}</p></>}
      {signup && !sent && method === 'email' && <label style={{ display: 'flex', gap: 10, fontSize: 12 }}><input type="checkbox" checked={marketing} onChange={e => setMarketing(e.target.checked)} disabled={busy} />Email me iDogs news and offers (optional). Unsubscribe any time.</label>}
      {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div ref={captchaElement} />
      <button className="btn btn-primary" type="submit" disabled={busy || (method === 'email' && cooldown > 0)} style={{ minHeight: 48 }}>{busy ? 'Please wait…' : method === 'email' ? cooldown ? `Send another link in ${cooldown}s` : 'Email me a sign-in link' : sent ? completed.current ? 'Finish signing in' : 'Verify code and continue' : 'Send sign-in code'}</button>
    </form>
  </div>
}
