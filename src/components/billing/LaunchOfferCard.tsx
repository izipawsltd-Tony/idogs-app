import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { User } from 'firebase/auth'
import { LAUNCH_OFFER, daysLeft } from '../../../shared/access-grants.js'
import { isNativeRuntime } from './FoundingMemberCard'

export interface OfferStatus {
  launch: { active: boolean; remaining: number; endsAt: string; showRemaining: boolean }
  pass: { active: boolean; endsAt: string }
}

// Public, cached status (real counter). Web only; the native apps never
// show the campaign or call its endpoints.
export function useOfferStatus(): OfferStatus | null {
  const [status, setStatus] = useState<OfferStatus | null>(null)
  useEffect(() => {
    if (isNativeRuntime()) return
    let cancelled = false
    fetch('/api/offer-status')
      .then(r => (r.ok ? r.json() : null))
      .then(body => { if (!cancelled && body?.launch && body?.pass) setStatus(body as OfferStatus) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])
  return status
}

function formatDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function LaunchCountdownLine({ status, now = Date.now() }: { status: OfferStatus; now?: number }) {
  const days = daysLeft(LAUNCH_OFFER.claimEnd, now)
  return (
    <span data-testid="launch-countdown">
      {days === 1 ? 'Last day' : `${days} days left`} · ends 31 December
      {status.launch.showRemaining ? ` · only ${status.launch.remaining} of ${LAUNCH_OFFER.maxRedemptions} places left` : ''}
    </span>
  )
}

interface Props {
  status: OfferStatus | null
  user: User | null
  hasPass: boolean
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
  onClaimed?: () => void
}

export default function LaunchOfferCard({ status, user, hasPass, toast, onClaimed }: Props) {
  const [loading, setLoading] = useState(false)
  const [needsDog, setNeedsDog] = useState(false)
  const [claimedUntil, setClaimedUntil] = useState<string | null>(null)

  if (isNativeRuntime() || !status?.launch.active) return null
  if (hasPass && !claimedUntil) return null

  async function claim() {
    if (!user || loading) return
    setLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/claim-launch-offer', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } })
      const body = await res.json().catch(() => ({}))
      if (res.ok) { setClaimedUntil(body.grantedUntil); toast('Your free year of iDogs Plus is active!', 'success'); onClaimed?.(); return }
      if (body.code === 'LAUNCH_NEEDS_DOG') setNeedsDog(true)
      toast(body.error || 'Could not claim the offer. Please try again.', body.code === 'LAUNCH_NEEDS_DOG' ? 'info' : 'error')
    } catch {
      toast('Could not claim the offer. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div id="launch-offer" data-testid="launch-offer-card" style={{ border: '2px solid var(--green-mid)', borderRadius: 14, padding: '18px 20px', marginBottom: 28, background: 'var(--green-light)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, color: 'var(--green)', textTransform: 'uppercase' }}>
        <LaunchCountdownLine status={status} />
      </div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: '6px 0 4px', color: 'var(--dark)' }}>
        1 year of iDogs Plus, FREE Gift Voucher — for 100 dog owners &amp; dog breeders
      </h2>
      <p style={{ fontSize: 14, color: 'var(--mid)', margin: '0 0 12px' }}>
        Snap your vaccination book — iDogs Scan fills in the records for you. Up to 5 dogs, litters and more, free for a full year.
        No card needed and nothing renews; afterwards your account simply returns to the Free plan with all your records kept.
      </p>
      {claimedUntil ? (
        <strong style={{ color: 'var(--green)' }}>Claimed! You have iDogs Plus until {formatDate(claimedUntil)}.</strong>
      ) : needsDog ? (
        <Link to="/app/dogs/new" className="btn btn-primary">Add your first dog</Link>
      ) : (
        <button className="btn btn-primary" disabled={!user || loading} onClick={claim}>
          {loading ? 'Claiming…' : 'Claim your free year'}
        </button>
      )}
    </div>
  )
}
