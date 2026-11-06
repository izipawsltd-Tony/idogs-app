import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { linkEmailPasswordToExistingPhoneAccount, phoneEmailLinkStagingEnabled } from '../lib/phoneAccountEmailLink'

/** QA-only route. No new Firebase Auth identity is created. */
export default function PhoneAccountEmailLinkQaPage() {
  const { user, loading, checkEmailVerified, resendVerificationEmail } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [linked, setLinked] = useState(false)

  if (!phoneEmailLinkStagingEnabled()) return <Navigate to="/" replace />
  if (loading) return <div style={{ padding: 32 }}>Checking account…</div>
  if (!user) return <Navigate to="/login" replace />
  const isPhoneUser = user.providerData.some(provider => provider.providerId === 'phone')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!user || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await linkEmailPasswordToExistingPhoneAccount(user, email, password)
      setLinked(true)
      setMessage(result.verificationSent
        ? 'Email linked to the same account. Check the verification message, then return here.'
        : 'Email linked to the same account, but verification mail could not be sent. Use Resend verification email below.')
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : ''
      setError(code === 'auth/email-already-in-use'
        ? 'That email belongs to another account. No accounts were merged; use the original email or contact support.'
        : err instanceof Error ? err.message : 'Could not link this email. No new account was created.')
    } finally {
      setPassword('')
      setBusy(false)
    }
  }

  async function checkVerified() {
    setBusy(true); setError('')
    try {
      const verified = await checkEmailVerified()
      setMessage(verified ? 'Email verified. Use your email/password to sign in to this same account.' : 'Email verification is still pending.')
    } catch { setError('Could not check verification. Retry without creating another account.') }
    finally { setBusy(false) }
  }

  async function resend() {
    setBusy(true); setError('')
    try { await resendVerificationEmail(); setMessage('Verification email requested. Check your inbox and spam folder.') }
    catch { setError('Could not send verification email. Retry later.') }
    finally { setBusy(false) }
  }

  return <main style={{ maxWidth: 520, margin: '40px auto', padding: 24 }}>
    <h1 style={{ fontSize: 24 }}>Keep your phone account</h1>
    <p>Staging QA only. Add email sign-in without creating a new account. Your dogs and plan stay attached to the same Firebase UID.</p>
    <p><strong>Current account:</strong> {user.uid}</p>
    {!isPhoneUser ? <p role="status">This account has no phone sign-in provider. No linking action is available.</p> :
      user.email || linked ?
      <section>
        <p role="status">Linked email: {user.email || email.trim().toLowerCase()}</p>
        <p>{user.emailVerified ? 'Email verified.' : 'Verification required before using protected features.'}</p>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void checkVerified()}>I've verified — check again</button>
        {!user.emailVerified && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void resend()}>Resend verification email</button>}
      </section> :
      <form onSubmit={event => void submit(event)} style={{ display: 'grid', gap: 14 }}>
        <label>Email address<input className="form-input" type="email" autoComplete="email" required disabled={busy}
          value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>New password<input className="form-input" type="password" autoComplete="new-password" minLength={8} maxLength={128}
          required disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
        <button className="btn btn-primary" type="submit" disabled={busy}>Link email to this phone account</button>
      </form>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" style={{ color: 'var(--error)' }}>{error}</p>}
    <p style={{ marginTop: 20 }}><Link to="/login">Back to sign in</Link></p>
  </main>
}
