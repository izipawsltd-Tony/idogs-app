import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

interface LitterQuotaSummary {
  plan: 'free' | 'plus'
  unlimited: boolean
  includedLimit: number
  includedUsed: number
  extraLittersUsedInCurrentWindow: number
  extraCreditsAvailable: number
  extraCreditsConsumed: number
  extraLitterPriceAud: number
  checkoutEnabled: boolean
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`
}

export default function ExtraLitterButton({ toast }: Props) {
  const { user } = useAuth()
  const [summary, setSummary] = useState<LitterQuotaSummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setSummary(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const idToken = await user.getIdToken()
        const res = await fetch('/api/litter-quota-summary', {
          headers: { Authorization: `Bearer ${idToken}` },
          cache: 'no-store',
        })
        const body = await res.json().catch(() => ({}))
        if (!cancelled && res.ok) setSummary(body as LitterQuotaSummary)
      } catch {
        if (!cancelled) setSummary(null)
      }
    })()
    return () => { cancelled = true }
  }, [user])

  if (!summary || summary.plan !== 'plus' || summary.unlimited) return null

  async function handleCheckout() {
    if (!user || !summary?.checkoutEnabled || loading) return
    setLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/create-extra-litter-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ requestId: requestId() }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || typeof body.url !== 'string') throw new Error('CHECKOUT_UNAVAILABLE')
      window.location.href = body.url
    } catch {
      toast('Extra Litter checkout is unavailable. No payment was made.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const includedUsed = Math.min(summary.includedUsed, summary.includedLimit)
  const disabled = !summary.checkoutEnabled || loading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleCheckout}
        disabled={disabled}
        title={!summary.checkoutEnabled ? 'Payment is disabled until separately approved.' : undefined}
      >
        {loading ? 'Opening…' : `Add another litter — A$${summary.extraLitterPriceAud}`}
      </button>
      <span style={{ fontSize: 11, color: 'var(--light)' }}>
        {includedUsed}/{summary.includedLimit} included in current rolling 12 months
        {summary.extraCreditsAvailable > 0 ? ` · ${summary.extraCreditsAvailable} extra credit${summary.extraCreditsAvailable === 1 ? '' : 's'} available` : ''}
        {!summary.checkoutEnabled ? ' · checkout disabled for safe QA' : ''}
      </span>
    </div>
  )
}
