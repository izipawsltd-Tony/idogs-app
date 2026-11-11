import { useState } from 'react'
import type { User } from 'firebase/auth'
import { FOUNDING_OFFER } from '../../../shared/access-grants.js'

// Web-only: Apple/Google do not allow an in-app purchase path that bypasses
// their billing, so this card never renders inside the native apps (and
// /api/create-founding-checkout is also blocked in nativeApiRouting.ts).
export function isNativeRuntime(): boolean {
  if (import.meta.env.VITE_IDOGS_NATIVE_PLATFORM) return true
  const w = window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }
  return Boolean(w.Capacitor?.isNativePlatform?.())
}

function requestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

interface Props {
  user: User | null
  hasSubscription: boolean
  hasPass: boolean
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
  now?: number
}

export default function FoundingMemberCard({ user, hasSubscription, hasPass, toast, now = Date.now() }: Props) {
  const [accepted, setAccepted] = useState(false)
  const [loading, setLoading] = useState(false)

  if (isNativeRuntime()) return null
  if (!(now >= FOUNDING_OFFER.salesStart && now < FOUNDING_OFFER.salesEnd)) return null
  if (hasSubscription) return null

  async function buy() {
    if (!user || !accepted || loading) return
    setLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/create-founding-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ requestId: requestId(), acceptTerms: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) { toast(body.error || 'Could not start checkout. No payment has been taken.', 'error'); return }
      window.location.href = body.url
    } catch {
      toast('Could not start checkout. No payment has been taken.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div data-testid="founding-member-card" style={{
      border: '2px solid var(--gold)', borderRadius: 14, padding: '18px 20px', marginBottom: 28, background: 'var(--gold-light)',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: 'var(--gold)', textTransform: 'uppercase' }}>
        Founding Member · first {FOUNDING_OFFER.seats} only
      </div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: '6px 0 4px', color: 'var(--dark)' }}>
        A$49 for {FOUNDING_OFFER.months} months of iDogs Plus
      </h2>
      <p style={{ fontSize: 14, color: 'var(--mid)', margin: '0 0 12px' }}>
        One payment, no subscription and no automatic renewal. Help shape iDogs as one of our first members.
        {hasPass ? ' Buying now adds 15 months on top of your current pass.' : ''}
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--mid)', marginBottom: 12 }}>
        <input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
        <span>{FOUNDING_OFFER.terms}</span>
      </label>
      <button className="btn btn-primary" disabled={!user || !accepted || loading} onClick={buy}>
        {loading ? 'Opening checkout…' : 'Become a Founding Member'}
      </button>
    </div>
  )
}
