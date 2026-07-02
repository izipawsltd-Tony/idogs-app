import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await resetPassword(email)
      setSent(true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('invalid-email')) {
        setError('Please enter a valid email address.')
      } else if (msg.includes('too-many-requests')) {
        setError('Too many requests. Please wait a few minutes and try again.')
      } else {
        // user-not-found → generic message to avoid revealing whether email exists
        setSent(true)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--sand)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Link to="/" style={{ display: 'inline-block', textDecoration: 'none' }}>
            <img src="/logo.png" alt="iDogs" style={{ height: 72, width: 240, objectFit: 'contain' }} />
          </Link>
        </div>

        <div className="card" style={{ padding: '32px 28px' }}>
          <h1 style={{ fontSize: 22, fontFamily: 'var(--font-display)', marginBottom: 6, color: 'var(--dark)' }}>Reset your password</h1>
          <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 28 }}>
            Enter your email and we'll send you a reset link.
          </p>

          {sent ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>📧</div>
              <p style={{ fontSize: 15, color: 'var(--dark)', fontWeight: 500, marginBottom: 8 }}>Check your email</p>
              <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 24 }}>
                If this email is registered, a password reset link has been sent.
              </p>
              <Link to="/login" style={{ color: 'var(--green)', fontWeight: 500, textDecoration: 'none', fontSize: 14 }}>
                ← Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="form-group">
                <label className="form-label">Email address</label>
                <input
                  className="form-input"
                  type="email"
                  placeholder="you@email.com.au"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              {error && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', fontSize: 13, color: 'var(--error)' }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', height: 46, fontSize: 15, marginTop: 4 }}
                disabled={loading}
              >
                {loading ? <span className="spinner" /> : 'Send reset link'}
              </button>
            </form>
          )}
        </div>

        {!sent && (
          <p style={{ textAlign: 'center', marginTop: 20, fontSize: 14, color: 'var(--mid)' }}>
            Remember your password?{' '}
            <Link to="/login" style={{ color: 'var(--green)', fontWeight: 500, textDecoration: 'none' }}>
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
