import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSearchParams } from 'react-router-dom'
import type { ToastMessage } from '../types'
import { PLUS_MONTHLY_PRICE_AUD, PLUS_ANNUAL_PRICE_AUD } from '../lib/pricingCopy'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

interface BillingInvoice {
  id: string
  number: string | null
  status: string
  amountPaid: number
  amountDue: number
  currency: string
  createdAt: string | null
  hostedInvoiceUrl: string | null
  invoicePdf: string | null
}

interface BillingSummary {
  subscription: {
    id: string
    status: string
    cancelAtPeriodEnd: boolean
    currentPeriodEnd: string | null
  } | null
  invoices: BillingInvoice[]
  canManageBilling: boolean
  sms: {
    configured: boolean
    status: 'active' | 'inactive' | 'past_due' | 'cancelled' | string
    creditsUsed: number
    creditsLimit: number
    periodStart: string | null
    periodEnd: string | null
  }
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency || 'AUD',
  }).format(cents / 100)
}

function formatBillingDate(value: string | null): string {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? 'Not available'
    : date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

// iDogs Pricing v1.1 (Pricing_Decision_Record_v1.1.md §1.1, LOCKED) —
// only two real entitlements: Free and Plus. Monthly/Annual are billing
// intervals of Plus, not separate tiers. The $40 annual launch offer is
// deliberately NOT implemented. Prices/caps below are the single source
// of truth for this page — keep in sync with api/_lib/checkout-handler.js
// (price ids), api/_lib/dog-cap.js (DOG_CAP), api/_lib/entitlements.js
// (SCAN_QUOTA) if any of these ever change.
const FREE_FEATURES = [
  'Up to 2 dogs',
  'Permanent Dog ID & QR Passport',
  'Health records & email reminders',
  'Ownership transfer',
  '2 free AI scans — one-time',
]
const PLUS_FEATURES = [
  'Up to 5 dogs',
  'Everything in Free',
  '10 AI Document Scans / month',
  '1 litter per 12 months',
  'PDF & CSV report export',
]

type IntervalKey = 'plus_monthly' | 'plus_annual'

export default function BillingPage({ toast }: Props) {
  const { user, profile, refreshProfile } = useAuth()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [smsCheckoutLoading, setSmsCheckoutLoading] = useState(false)
  const [smsRemoveLoading, setSmsRemoveLoading] = useState(false)
  const [detailsLoading, setDetailsLoading] = useState(true)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [billingDetails, setBillingDetails] = useState<BillingSummary | null>(null)
  const [interval, setInterval] = useState<IntervalKey>('plus_monthly')

  const isPlus = profile?.plan === 'plus'
  const isOwner = profile?.role === 'owner'
  const billingInterval = (profile as any)?.billingInterval as 'monthly' | 'annual' | undefined
  const subscriptionStatus = (profile as any)?.subscriptionStatus as string | undefined
  const isPastDue = isPlus && subscriptionStatus === 'past_due'

  useEffect(() => {
    if (searchParams.get('success')) {
      toast('🎉 Subscription activated! Welcome to iDogs Plus.', 'success')
    }
    if (searchParams.get('cancelled')) {
      toast('Checkout cancelled — you can try again anytime.', 'info')
    }
    if (searchParams.get('sms_success')) {
      toast('SMS add-on checkout completed. Activation will appear after Stripe confirms it.', 'success')
    }
    if (searchParams.get('sms_cancelled')) {
      toast('SMS add-on checkout cancelled.', 'info')
    }
    if (searchParams.get('sms_removed')) {
      toast('SMS add-on removed. Your iDogs Plus subscription remains active.', 'success')
    }
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false

    const loadBillingDetails = async (showLoading = false) => {
      if (showLoading) {
        setDetailsLoading(true)
        setDetailsError(null)
      }
      try {
        const idToken = await user.getIdToken()
        const res = await fetch('/api/billing-summary', {
          headers: { Authorization: `Bearer ${idToken}` },
          cache: 'no-store',
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'Failed to load billing details')
        if (!cancelled) {
          setBillingDetails(body as BillingSummary)
          setDetailsError(null)
          // Billing/webhook updates happen server-side after login. useAuth keeps
          // the profile read from the original auth-state event, so refresh the
          // trusted Firestore entitlement whenever secure billing state refreshes.
          // Keep this best-effort: a profile refresh failure must never turn a
          // successful billing-summary response into a billing UI error.
          void refreshProfile().catch(err => console.error('Failed to refresh billing entitlement profile:', err))
        }
      } catch {
        if (!cancelled && showLoading) setDetailsError('Billing details are temporarily unavailable.')
      } finally {
        if (!cancelled && showLoading) setDetailsLoading(false)
      }
    }

    void loadBillingDetails(true)

    // Returning from Stripe's hosted invoice can restore this page from the
    // browser back/forward cache without remounting React. Refresh billing
    // state on focus/pageshow/visibility so webhook-confirmed SMS entitlement
    // and the new invoice appear without requiring Ctrl+F5.
    const refreshAfterExternalBilling = () => {
      if (document.visibilityState !== 'hidden') void loadBillingDetails(false)
    }
    window.addEventListener('focus', refreshAfterExternalBilling)
    window.addEventListener('pageshow', refreshAfterExternalBilling)
    document.addEventListener('visibilitychange', refreshAfterExternalBilling)

    return () => {
      cancelled = true
      window.removeEventListener('focus', refreshAfterExternalBilling)
      window.removeEventListener('pageshow', refreshAfterExternalBilling)
      document.removeEventListener('visibilitychange', refreshAfterExternalBilling)
    }
  }, [user])

  async function handleOpenPortal() {
    if (!user) return
    setPortalLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/create-billing-portal', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.url) throw new Error('Portal unavailable')
      window.location.href = body.url
    } catch {
      toast('Failed to open billing management. Please try again.', 'error')
    } finally {
      setPortalLoading(false)
    }
  }

  async function handleSubscribe(planKey: IntervalKey) {
    if (!user) return
    setLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ plan: planKey }),
      })
      if (!res.ok) throw new Error('Failed to create checkout')
      const { url } = await res.json()
      window.location.href = url
    } catch {
      toast('Failed to start checkout. Please try again.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function handleSmsSubscribe() {
    if (!user) return
    setSmsCheckoutLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/create-sms-addon-checkout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'SMS add-on unavailable')

      if (body.hostedInvoiceUrl) {
        window.location.href = body.hostedInvoiceUrl
        return
      }

      toast(
        body.status === 'pending_payment'
          ? 'SMS add-on payment is pending. It will activate after Stripe confirms payment.'
          : 'SMS add-on update submitted. Activation will appear after Stripe confirms it.',
        'success',
      )
      window.location.href = '/app/billing?sms_success=1'
    } catch {
      toast('SMS add-on is unavailable. Please check Billing or try again later.', 'error')
    } finally {
      setSmsCheckoutLoading(false)
    }
  }


  async function handleSmsRemove() {
    if (!user || smsRemoveLoading) return
    const confirmed = window.confirm('Remove the SMS add-on? Your iDogs Plus subscription will stay active.')
    if (!confirmed) return

    setSmsRemoveLoading(true)
    try {
      const idToken = await user.getIdToken()
      const res = await fetch('/api/remove-sms-addon', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Failed to remove SMS add-on')

      setBillingDetails(current => current ? {
        ...current,
        sms: {
          ...current.sms,
          status: 'cancelled',
          periodStart: null,
          periodEnd: null,
        },
      } : current)
      toast('SMS add-on removed. Your iDogs Plus subscription remains active.', 'success')
    } catch {
      toast('Failed to remove SMS add-on. Please try again.', 'error')
    } finally {
      setSmsRemoveLoading(false)
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 800 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>
          Billing & Plans
        </h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>
          Simple pricing — free forever for 1-2 dogs, upgrade when you need more. Paid prices are in AUD and include GST.
        </p>
      </div>

      {/* Current plan banner */}
      <div style={{
        background: isPastDue ? 'var(--gold-light)' : isPlus ? 'var(--green-light)' : 'var(--sand)',
        border: `1px solid ${isPastDue ? 'rgba(200,151,31,0.3)' : isPlus ? 'rgba(8,80,65,0.12)' : 'var(--border)'}`,
        borderRadius: 12, padding: '14px 20px', marginBottom: 28,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: isPastDue ? 'var(--gold)' : isPlus ? 'var(--green)' : 'var(--dark)' }}>
            {isPastDue ? '⚠️ ' : isPlus ? '✓ ' : '🐾 '}
            Current plan: {isPlus ? `Plus (${billingInterval === 'annual' ? 'Annual' : 'Monthly'})` : 'Free'}
          </span>
          {isPastDue && (
            <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 2 }}>
              Your last payment failed. Plus access continues for a 7-day grace period — please update your payment method.
            </div>
          )}
        </div>
      </div>

      {/* Stripe-backed subscription management */}
      {(detailsLoading || detailsError || billingDetails?.canManageBilling) && (
        <div className="card" style={{ marginBottom: 24, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--dark)' }}>Subscription management</div>
              {detailsLoading ? (
                <div style={{ fontSize: 12, color: 'var(--light)', marginTop: 4 }}>Loading secure billing details…</div>
              ) : detailsError ? (
                <div role="alert" style={{ fontSize: 12, color: 'var(--danger, #C0392B)', marginTop: 4 }}>{detailsError}</div>
              ) : billingDetails?.subscription ? (
                <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>
                  {billingDetails.subscription.cancelAtPeriodEnd ? 'Access scheduled to end' : 'Next renewal'}: <strong>{formatBillingDate(billingDetails.subscription.currentPeriodEnd)}</strong>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>Manage payment methods, invoices and cancellation securely in Stripe.</div>
              )}
            </div>
            {billingDetails?.canManageBilling && (
              <button type="button" className="btn btn-secondary" onClick={handleOpenPortal} disabled={portalLoading}>
                {portalLoading ? 'Opening…' : 'Manage subscription'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Free tier highlight */}
      {isOwner && !isPlus && (
        <div style={{ background: 'var(--green-light)', border: '1px solid rgba(8,80,65,0.12)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, fontSize: 13, color: 'var(--green)' }}>
          🐾 <strong>Pet Owner perk:</strong> iDogs is free forever for up to 2 dogs. No credit card needed.
        </div>
      )}

      {/* Monthly/Annual selector */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
        <div style={{ display: 'inline-flex', background: 'var(--sand)', borderRadius: 10, padding: 4 }}>
          <button
            onClick={() => setInterval('plus_monthly')}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', background: interval === 'plus_monthly' ? '#fff' : 'transparent',
              color: interval === 'plus_monthly' ? 'var(--dark)' : 'var(--light)',
              boxShadow: interval === 'plus_monthly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            Monthly
          </button>
          <button
            onClick={() => setInterval('plus_annual')}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', background: interval === 'plus_annual' ? '#fff' : 'transparent',
              color: interval === 'plus_annual' ? 'var(--dark)' : 'var(--light)',
              boxShadow: interval === 'plus_annual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            Annual
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', background: 'var(--green-light)', padding: '2px 6px', borderRadius: 20 }}>
              ANNUAL OPTION
            </span>
          </button>
        </div>
      </div>

      {/* Plans grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
        {/* Free */}
        <div style={{ background: '#fff', border: '2px solid var(--border)', borderRadius: 16, padding: 20 }}>
          <div style={{ fontSize: 24, marginBottom: 6 }}>🐾</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--dark)', marginBottom: 2 }}>Free</div>
          <div style={{ fontSize: 12, color: 'var(--light)', marginBottom: 12 }}>Perfect for pet owners with 1-2 dogs</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: 'var(--dark)', marginBottom: 16 }}>$0</div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FREE_FEATURES.map(f => (
              <li key={f} style={{ fontSize: 12, color: 'var(--dark)', display: 'flex', gap: 7 }}>
                <span style={{ color: 'var(--mid)', flexShrink: 0 }}>✓</span>{f}
              </li>
            ))}
          </ul>
          <div style={{
            textAlign: 'center', padding: '9px', background: !isPlus ? 'var(--green-light)' : 'var(--sand)',
            borderRadius: 10, fontSize: 12, fontWeight: 600, color: !isPlus ? 'var(--green)' : 'var(--mid)',
          }}>
            {!isPlus ? '✓ Current plan' : 'Always free'}
          </div>
        </div>

        {/* Plus */}
        <div style={{ background: '#fff', border: '2px solid var(--green)', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 20px rgba(8,80,65,0.12)' }}>
          <div style={{ background: 'var(--green)', color: '#fff', fontSize: 11, fontWeight: 700, textAlign: 'center', padding: 5, letterSpacing: '0.05em' }}>
            MOST POPULAR
          </div>
          <div style={{ padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🏆</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--dark)', marginBottom: 2 }}>Plus</div>
            <div style={{ fontSize: 12, color: 'var(--light)', marginBottom: 12 }}>For active breeders with a growing kennel</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: 'var(--green)' }}>
                {interval === 'plus_annual' ? `$${PLUS_ANNUAL_PRICE_AUD}` : `$${PLUS_MONTHLY_PRICE_AUD}`}
              </span>
              <span style={{ fontSize: 12, color: 'var(--light)' }}>{interval === 'plus_annual' ? 'AUD/year' : 'AUD/month'}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--light)', marginBottom: 16 }}>
              {interval === 'plus_annual'
                ? `≈ $${(PLUS_ANNUAL_PRICE_AUD / 12).toFixed(2)}/month, billed annually`
                : `$${PLUS_MONTHLY_PRICE_AUD * 12} AUD/year if paid monthly`}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PLUS_FEATURES.map(f => (
                <li key={f} style={{ fontSize: 12, color: 'var(--dark)', display: 'flex', gap: 7 }}>
                  <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>{f}
                </li>
              ))}
            </ul>
            {isPlus ? (
              <div style={{ textAlign: 'center', padding: '9px', background: 'var(--green-light)', borderRadius: 10, fontSize: 12, fontWeight: 600, color: 'var(--green)' }}>
                ✓ Current plan
              </div>
            ) : (
              <button
                onClick={() => handleSubscribe(interval)}
                disabled={loading}
                style={{
                  width: '100%', padding: '10px', background: 'var(--green)', color: '#fff',
                  border: '2px solid var(--green)', borderRadius: 10, fontSize: 13, fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
                }}
              >
                {loading
                  ? <><span className="spinner" style={{ width: 13, height: 13, borderTopColor: '#fff' }} /> Processing…</>
                  : `Upgrade to Plus — ${interval === 'plus_annual' ? `$${PLUS_ANNUAL_PRICE_AUD}/year` : `$${PLUS_MONTHLY_PRICE_AUD}/month`}`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Note */}
      <div style={{ background: 'var(--sand)', borderRadius: 12, padding: '14px 20px', marginBottom: 24, fontSize: 13, color: 'var(--mid)' }}>
        🐾 <strong>1-2 dogs?</strong> iDogs is free forever for up to 2 dogs — no credit card, no expiry.
        Ownership transfer and your dog's permanent QR Passport are free on every plan.
      </div>

      {/* SMS Add-on V1 */}
      <div className="card" style={{ marginBottom: 24, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>SMS Add-on</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--dark)' }}>$3</span>
              <span style={{ fontSize: 13, color: 'var(--light)' }}>AUD / month</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6 }}>
              20 SMS credits each billing month for vaccination, worming and breeding reminders:
              heat cycle, mating, pregnancy and whelping.
            </div>
            <div style={{ fontSize: 12, color: 'var(--light)', marginTop: 6 }}>
              One long or Unicode SMS can use more than one credit. Unused credits do not roll over.
            </div>
          </div>

          <div style={{ minWidth: 220, flex: '0 1 260px' }}>
            {detailsLoading ? (
              <div style={{ fontSize: 13, color: 'var(--light)' }}>Loading SMS status…</div>
            ) : detailsError ? (
              <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #C0392B)' }}>SMS status temporarily unavailable.</div>
            ) : (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--dark)', marginBottom: 8 }}>
                  Status: <span style={{ textTransform: 'capitalize' }}>{billingDetails?.sms.status || 'inactive'}</span>
                </div>
                {billingDetails?.sms.status === 'active' && (
                  <>
                    <div style={{ fontSize: 13, color: 'var(--mid)', marginBottom: 6 }}>
                      Usage: <strong>{billingDetails.sms.creditsUsed} / {billingDetails.sms.creditsLimit}</strong> credits
                    </div>
                    <div style={{ height: 8, borderRadius: 999, background: 'var(--sand)', overflow: 'hidden', marginBottom: 8 }}>
                      <div style={{
                        width: `${Math.min(100, (billingDetails.sms.creditsUsed / Math.max(1, billingDetails.sms.creditsLimit)) * 100)}%`,
                        height: '100%',
                        background: 'var(--green)',
                      }} />
                    </div>
                    {billingDetails.sms.creditsUsed >= billingDetails.sms.creditsLimit && (
                      <div role="alert" style={{ fontSize: 12, color: 'var(--danger, #C0392B)', marginBottom: 8 }}>
                        SMS credits exhausted. Email and in-app reminders continue normally.
                      </div>
                    )}
                    {billingDetails.sms.creditsUsed < billingDetails.sms.creditsLimit &&
                     billingDetails.sms.creditsUsed >= billingDetails.sms.creditsLimit * 0.8 && (
                      <div style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 8 }}>
                        You have used at least 80% of this month's SMS credits.
                      </div>
                    )}
                  </>
                )}

                {billingDetails?.sms.status === 'active' || billingDetails?.sms.status === 'past_due' ? (
                  <button className="btn btn-secondary" type="button" onClick={handleSmsRemove} disabled={smsRemoveLoading}>
                    {smsRemoveLoading ? 'Removing SMS…' : 'Remove SMS add-on'}
                  </button>
                ) : !isPlus ? (
                  <div style={{ fontSize: 12, color: 'var(--light)' }}>Upgrade to iDogs Plus before adding SMS reminders.</div>
                ) : !billingDetails?.sms.configured ? (
                  <button className="btn btn-secondary" type="button" disabled title="Stripe SMS add-on is not configured for this environment">
                    SMS add-on coming soon
                  </button>
                ) : (
                  <button className="btn btn-primary" type="button" onClick={handleSmsSubscribe} disabled={smsCheckoutLoading}>
                    {smsCheckoutLoading ? 'Adding SMS…' : 'Add SMS — $3/month'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Payment history */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Payment history</div>
        {detailsLoading ? (
          <div style={{ fontSize: 13, color: 'var(--light)' }}>Loading payment history…</div>
        ) : detailsError ? (
          <div role="alert" style={{ fontSize: 13, color: 'var(--danger, #C0392B)' }}>{detailsError}</div>
        ) : !billingDetails?.invoices.length ? (
          <div style={{ fontSize: 13, color: 'var(--light)' }}>No invoices yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {billingDetails.invoices.map((invoice, index) => (
              <div key={invoice.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: index ? '1px solid var(--sand)' : 'none', fontSize: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--dark)' }}>{invoice.number || 'Stripe invoice'}</div>
                  <div style={{ color: 'var(--light)', marginTop: 2 }}>{formatBillingDate(invoice.createdAt)}</div>
                </div>
                <div style={{ color: 'var(--mid)', textTransform: 'capitalize' }}>{invoice.status.replaceAll('_', ' ')}</div>
                <div style={{ fontWeight: 600, color: 'var(--dark)' }}>{formatMoney(invoice.amountPaid || invoice.amountDue, invoice.currency)}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {invoice.hostedInvoiceUrl && <a className="btn btn-secondary btn-sm" href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">View</a>}
                  {invoice.invoicePdf && <a className="btn btn-secondary btn-sm" href={invoice.invoicePdf} target="_blank" rel="noreferrer">PDF</a>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FAQ */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>FAQ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { q: 'Is the free plan really free forever?', a: 'Yes — up to 2 dogs is free forever. No credit card required, no expiry.' },
            { q: 'What happens if I have more than 5 dogs on Plus (or more than 2 on Free)?', a: 'Nothing is ever deleted. Dogs beyond your plan’s limit become read-only — you can still view them, transfer them, and their QR Passport keeps working. You choose which dogs stay active, and can swap at any time.' },
            { q: 'How do the 10 AI scans/month work?', a: 'Plus includes 10 AI Document Scans every month, resetting on your billing date — whether you’re on Monthly or Annual. Unused scans don’t roll over. Free accounts get 2 scans total, for the life of the account.' },
            { q: 'What if my payment fails?', a: 'You keep full Plus access for 7 days while we retry the payment. After that, your account moves to the Free plan (no data is ever deleted) until payment succeeds.' },
            { q: 'Is my payment secure?', a: 'Yes — payments are processed by Stripe, PCI DSS Level 1 certified. We never store your card details.' },
          ].map((item, i, arr) => (
            <div key={i} style={{ paddingBottom: i < arr.length - 1 ? 14 : 0, borderBottom: i < arr.length - 1 ? '1px solid var(--sand)' : 'none' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>{item.q}</div>
              <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6 }}>{item.a}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}