import { useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'
import { isNativeRuntime } from '../components/billing/FoundingMemberCard'
import { GIFT_OFFER } from '../../shared/access-grants.js'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

// Kennel gift for past puppy buyers: one free year of iDogs Plus, claimed on
// the website with the code from the Owner's SMS. No payment details.
export default function GiftRedeemPage({ toast }: Props) {
  const { user, refreshProfile } = useAuth()
  const [params] = useSearchParams()
  const [code, setCode] = useState(params.get('code') || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ grantedUntil: string; hasSubscription: boolean } | null>(null)

  if (isNativeRuntime()) {
    return (
      <div style={{ padding: 32, maxWidth: 560 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>Gift</h1>
        <p style={{ fontSize: 14, color: 'var(--mid)' }}>Gifts are claimed on the iDogs website. Once claimed, your Plus access works here automatically.</p>
      </div>
    )
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault()
    if (!user || loading || !code.trim()) return
    setLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/redeem-gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ code: code.trim() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast(body.error || 'Could not claim the gift. Please try again.', 'error'); return }
      setResult({ grantedUntil: body.grantedUntil, hasSubscription: body.hasSubscription === true })
      void refreshProfile().catch(() => undefined)
    } catch {
      toast('Could not claim the gift. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 560 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 6 }}>
        🎁 Your free year of iDogs Plus
      </h1>
      <p style={{ fontSize: 14, color: 'var(--mid)', marginBottom: 20 }}>
        A thank-you from your breeder: {GIFT_OFFER.months} months of iDogs Plus — your dog&apos;s whole life record,
        plus vaccination and worming reminders. No payment details needed, and nothing renews or charges you afterwards.
      </p>
      {result ? (
        <div data-testid="gift-claimed" style={{ background: 'var(--green-light)', borderRadius: 12, padding: '16px 18px' }}>
          <strong style={{ color: 'var(--green)' }}>Gift claimed!</strong>
          <p style={{ fontSize: 14, margin: '6px 0 0' }}>You have iDogs Plus until {formatDate(result.grantedUntil)}.</p>
          {result.hasSubscription && (
            <p style={{ fontSize: 13, color: 'var(--mid)', margin: '8px 0 0' }}>
              You also have an iDogs Plus subscription. It keeps running separately — if you no longer need it, you can cancel it in Billing.
            </p>
          )}
          <p style={{ margin: '12px 0 0' }}><Link to="/app/dogs/new" className="btn btn-primary">Add your dog</Link></p>
        </div>
      ) : (
        <form onSubmit={claim} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>
            Gift code
            <input className="input" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" style={{ display: 'block', width: '100%', marginTop: 6 }} />
          </label>
          <button className="btn btn-primary" type="submit" disabled={!user || loading || !code.trim()}>
            {loading ? 'Claiming…' : 'Claim my free year'}
          </button>
        </form>
      )}
    </div>
  )
}
