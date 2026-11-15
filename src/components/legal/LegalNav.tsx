import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

// Header for Privacy / Terms. On the website it keeps the marketing bar.
// In the iPhone/Android app (no browser back button) it shows a Back button
// below the status bar that returns to where the user came from.
export default function LegalNav() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const native = typeof document !== 'undefined' && document.documentElement.hasAttribute('data-idogs-native-platform')
  const fallback = user ? '/app/settings' : '/login'
  const back = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx
    if (typeof idx === 'number' && idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }
  const bar = { position: 'sticky' as const, top: 0, zIndex: 100, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
  if (native) {
    return (
      <nav className="idogs-legal-nav-native" style={{ ...bar, height: 'auto', minHeight: 56, padding: 'calc(var(--safe-area-top, env(safe-area-inset-top, 0px)) + 6px) 16px 6px' }}>
        <button type="button" onClick={back} aria-label="Back" style={{ minHeight: 44, minWidth: 44, display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, fontSize: 16, fontWeight: 600, color: 'var(--green)', cursor: 'pointer' }}>
          <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>‹</span> Back
        </button>
        <img src="/01_idogs_primary_horizontal_transparent.png" alt="iDogs" style={{ height: 28 }} />
        <span style={{ width: 44 }} aria-hidden="true" />
      </nav>
    )
  }
  return (
    <nav style={bar}>
      <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
        <img src="/01_idogs_primary_horizontal_transparent.png" alt="iDogs" style={{ height: 34 }} />
      </Link>
      <Link to={user ? '/app/dashboard' : '/signup'} className="btn btn-primary btn-sm">{user ? 'Open iDogs' : 'Start free'}</Link>
    </nav>
  )
}
