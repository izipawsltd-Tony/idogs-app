import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ConfirmationResult, RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { phoneEmailLinkStagingEnabled } from '../lib/phoneAccountEmailLink'

// A blank allowlist disables OTP sending entirely. Only explicitly configured
// Firebase TEST phone numbers are allowed, for this QA branch. This UI is
// not the production phone login, and must never be used for customer numbers.
export function allowedStagingPhoneQaNumbers(): string[] {
  if (!phoneEmailLinkStagingEnabled()) return []
  return (import.meta.env.VITE_IDOGS_PHONE_OTP_QA_NUMBERS || '')
    .split(',').map((s: string) => s.trim()).filter((s: string) => /^\+[1-9][0-9]{7,14}$/.test(s))
}

export default function PhoneSignInQaPage() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<ConfirmationResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const captcha = useRef<RecaptchaVerifier | null>(null)
  const allowed = allowedStagingPhoneQaNumbers()

  useEffect(() => {
    return () => {
      void captcha.current?.clear()
      captcha.current = null
    }
  }, [])

  if (!phoneEmailLinkStagingEnabled()) return <Navigate replace to="/login" />
  if (loading) return <main style={{ padding: 24 }}>Checking account…</main>
  if (user) return <Navigate replace to="/qa/phone-email-link" />

  async function sendOtp(event: FormEvent) {
    event.preventDefault()
    if (busy || !allowed.includes(phone.trim())) return
    setBusy(true); setError('')
    try {
      if (!captcha.current) {
        captcha.current = new RecaptchaVerifier(auth, 'idogs-staging-qa-recaptcha', { size: 'normal' })
      }
      // Invoked only by a human button click on a QA-approved test number.
      const confirmation = await signInWithPhoneNumber(auth, phone.trim(), captcha.current)
      setPending(confirmation)
    } catch {
      setError('Could not start QA phone sign-in. Confirm this is a Firebase Auth test number and retry.')
      await captcha.current?.clear()
      captcha.current = null
    } finally { setBusy(false) }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault()
    if (!pending || busy) return
    setBusy(true); setError('')
    try {
      const result = await pending.confirm(code)
      const hasPhone = result.user.providerData.some(p => p.providerId === 'phone')
      if (!hasPhone) throw new Error('No phone provider linked')
      navigate('/qa/phone-email-link', { replace: true })
    } catch {
      setError('Could not confirm this QA code. The original phone account has not been verified.')
    } finally { setBusy(false) }
  }

  return <main style={{ maxWidth: 480, margin: '40px auto', padding: 24 }}>
    <h1>Existing mobile account — QA only</h1>
    <p>Only staging Firebase test phone numbers explicitly approved for PR #65 are accepted. Never enter a customer phone number. Phone sign-in may create an account for an unknown number, so the test number must already belong to the original synthetic QA user.</p>
    {!allowed.length ? <p role="status">QA phone sign-in is disabled until Firebase test numbers are configured in this branch's Preview environment.</p> :
      !pending ? <form onSubmit={e => void sendOtp(e)} style={{ display: 'grid', gap: 12 }}>
        <label>Approved test phone number<input className="form-input" type="tel" autoComplete="tel" required
          value={phone} onChange={e => setPhone(e.target.value)} placeholder="+61400000000" /></label>
        <div id="idogs-staging-qa-recaptcha" />
        <button className="btn btn-primary" type="submit" disabled={busy || !allowed.includes(phone.trim())}>Request QA verification code</button>
      </form> : <form onSubmit={e => void verifyOtp(e)} style={{ display: 'grid', gap: 12 }}>
        <label>QA verification code<input className="form-input" type="text" autoComplete="one-time-code" required value={code} onChange={e=>setCode(e.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>Verify original phone account</button>
      </form>}
    {error && <p role="alert" style={{ color: 'var(--error)' }}>{error}</p>}
    <p><Link to="/login">Back to email sign-in</Link></p>
  </main>
}
