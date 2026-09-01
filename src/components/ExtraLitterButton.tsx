import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
  onCreateAvailabilityChange?: (allowed: boolean | null) => void
  refreshKey?: number
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

function includedRemainingLabel(remaining: number): string {
  if (remaining <= 0) return 'No included litters remaining'
  return `${remaining} included litter${remaining === 1 ? '' : 's'} remaining`
}

export default function ExtraLitterButton({ toast, onCreateAvailabilityChange, refreshKey = 0 }: Props) {
  const { user } = useAuth()
  const [summary, setSummary] = useState<LitterQuotaSummary | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setSummary(null)
      onCreateAvailabilityChange?.(null)
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
        if (!cancelled && res.ok) {
          const parsed = body as LitterQuotaSummary
          setSummary(parsed)
          const used = Math.min(parsed.includedUsed, parsed.includedLimit)
          const allowed = parsed.unlimited || (parsed.plan === 'plus' && (used < parsed.includedLimit || parsed.extraCreditsAvailable > 0))
          onCreateAvailabilityChange?.(allowed)
        } else if (!cancelled) {
          setSummary(null)
          onCreateAvailabilityChange?.(null)
        }
      } catch {
        if (!cancelled) {
          setSummary(null)
          onCreateAvailabilityChange?.(null)
        }
      }
    })()
    return () => { cancelled = true }
  }, [user, onCreateAvailabilityChange, refreshKey])

  if (!summary) return null
  if (summary.plan === 'free') {
    return (
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--light)' }}>
        Free plan — upgrade to Plus to create litters
      </span>
    )
  }
  if (summary.unlimited) return null

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
  const includedRemaining = Math.max(summary.includedLimit - includedUsed, 0)
  const includedExhausted = includedRemaining === 0
  const hasUnusedExtraCredit = summary.extraCreditsAvailable > 0
  const remainingLabel = includedRemainingLabel(includedRemaining)
  const breederHistoryLabel = "Based on your breeder profile’s rolling 12-month litter history"

  // Before the included allowance is exhausted, show how many included
  // litters remain rather than how many were "used". That avoids implying
  // the current login account created historical litters that may instead be
  // linked through the breeder profile. If a paid credit already exists,
  // show it instead of offering another charge.
  if (!includedExhausted || hasUnusedExtraCredit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          {remainingLabel}
        </span>
        <span style={{ fontSize: 11, color: 'var(--light)' }}>
          {hasUnusedExtraCredit
            ? `${summary.extraCreditsAvailable} extra litter credit${summary.extraCreditsAvailable === 1 ? '' : 's'} available`
            : breederHistoryLabel}
        </span>
      </div>
    )
  }

  const disabled = !summary.checkoutEnabled || loading
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleCheckout}
        disabled={disabled}
      >
        {loading ? 'Opening…' : `Add another litter — A$${summary.extraLitterPriceAud}`}
      </button>
      <span style={{ fontSize: 11, color: 'var(--light)' }}>
        {remainingLabel}
      </span>
      <span style={{ fontSize: 11, color: 'var(--light)' }}>
        {breederHistoryLabel}
      </span>
    </div>
  )
}
