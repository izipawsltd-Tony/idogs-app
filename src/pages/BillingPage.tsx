import { useState, useEffect } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSearchParams } from 'react-router-dom'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    icon: '🐾',
    color: '#5C5A54',
    description: 'Perfect for pet owners with 1-2 dogs',
    features: [
      'Up to 2 dogs',
      'QR Passport for each dog',
      'Vaccination & health records',
      'Email reminders',
      'Public passport page',
    ],
    cta: 'Current plan',
    isFree: true,
  },
  {
    id: 'basic',
    name: 'Basic',
    price: 5,
    icon: '🐕',
    color: 'var(--brand-600)',
    description: 'For casual breeders and growing families',
    features: [
      'Up to 10 dogs',
      'Everything in Free',
      'AI Document Scan',
      'Document storage',
      'Export PDF & CSV reports',
      'Ownership transfer',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 12,
    icon: '🏆',
    color: 'var(--brand-300)',
    description: 'For active breeders and growing kennels',
    popular: true,
    features: [
      'Up to 20 dogs',
      'Everything in Basic',
      'Litter management',
      'Audit trail',
      'SMS reminders (+$3/month)',
      'Priority email support',
    ],
  },
  {
    id: 'kennel',
    name: 'Kennel',
    price: 29,
    icon: '🏠',
    color: 'var(--gold-500)',
    description: 'For professional kennels',
    features: [
      'Unlimited dogs',
      'Everything in Pro',
      'Full compliance export',
      'Multi-litter management',
      'Advanced audit trail',
      'Priority support',
    ],
  },
]

export default function BillingPage({ toast }: Props) {
  const { user, profile } = useAuth()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState<string | null>(null)
  const [smsAddon, setSmsAddon] = useState(false)

  const currentPlan = profile?.plan || 'trial'
  const isOwner = profile?.role === 'owner'

  useEffect(() => {
    if (searchParams.get('success')) {
      toast('🎉 Subscription activated! Welcome to iDogs.', 'success')
    }
    if (searchParams.get('cancelled')) {
      toast('Subscription cancelled — you can try again anytime.', 'info')
    }
  }, [])

  async function handleSubscribe(planId: string) {
    if (!user) return
    if (planId === 'free') return
    setLoading(planId)
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan: planId,
          userId: user.uid,
          userEmail: user.email,
          smsAddon,
        }),
      })
      if (!res.ok) throw new Error('Failed to create checkout')
      const { url } = await res.json()
      window.location.href = url
    } catch {
      toast('Failed to start checkout. Please try again.', 'error')
    } finally {
      setLoading(null)
    }
  }

  const planLabel = (plan: string) => {
    if (plan === 'trial') return '30-day free trial'
    if (plan === 'free') return 'Free'
    return plan.charAt(0).toUpperCase() + plan.slice(1)
  }

  return (
    <div style={{ padding: 32, maxWidth: 1000 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>
          Billing & Plans
        </h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>
          Simple pricing — start free, upgrade when you need more.
        </p>
      </div>

      {/* Current plan banner */}
      <div style={{
        background: currentPlan === 'trial' ? 'var(--gold-light)' : 'var(--green-light)',
        border: `1px solid ${currentPlan === 'trial' ? 'rgba(200,151,31,0.2)' : 'rgba(8,80,65,0.12)'}`,
        borderRadius: 12, padding: '14px 20px', marginBottom: 28,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600, color: currentPlan === 'trial' ? 'var(--gold)' : 'var(--green)' }}>
            {currentPlan === 'trial' ? '🎉 ' : '✓ '}Current plan: {planLabel(currentPlan)}
          </span>
          {currentPlan === 'trial' && (
            <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 2 }}>
              Your trial includes all features. Choose a plan before it ends.
            </div>
          )}
        </div>
        {currentPlan !== 'trial' && (
          <span style={{ fontSize: 12, color: 'var(--green)', background: '#fff', padding: '4px 12px', borderRadius: 20, fontWeight: 600 }}>
            Active
          </span>
        )}
      </div>

      {/* Free tier highlight */}
      {isOwner && (
        <div style={{ background: 'var(--green-light)', border: '1px solid rgba(8,80,65,0.12)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, fontSize: 13, color: 'var(--green)' }}>
          🐾 <strong>Pet Owner perk:</strong> iDogs is free forever for up to 2 dogs. No credit card needed.
        </div>
      )}

      {/* SMS Add-on toggle */}
      <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)', marginBottom: 2 }}>📱 SMS Reminders add-on — $3/month</div>
          <div style={{ fontSize: 13, color: 'var(--light)' }}>Get SMS alerts for vaccine and worming due dates. Available on Basic, Pro and Kennel plans.</div>
        </div>
        <button
          onClick={() => setSmsAddon(!smsAddon)}
          style={{
            width: 48, height: 26, borderRadius: 13, flexShrink: 0,
            background: smsAddon ? 'var(--green)' : 'var(--border)',
            border: 'none', cursor: 'pointer',
            position: 'relative', transition: 'background 0.2s',
          }}
        >
          <span style={{
            position: 'absolute', top: 3,
            left: smsAddon ? 22 : 4,
            width: 20, height: 20,
            background: '#fff', borderRadius: '50%',
            transition: 'left 0.2s',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </button>
      </div>

      {/* Plans grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
        {PLANS.map(plan => {
          const isCurrentPlan = currentPlan === plan.id || (plan.id === 'free' && currentPlan === 'trial' && isOwner)
          const isPopular = plan.popular

          return (
            <div
              key={plan.id}
              style={{
                background: '#fff',
                border: `2px solid ${isPopular ? plan.color : 'var(--border)'}`,
                borderRadius: 16,
                overflow: 'hidden',
                position: 'relative',
                boxShadow: isPopular ? `0 4px 20px ${plan.color}20` : 'none',
              }}
            >
              {isPopular && (
                <div style={{
                  background: plan.color, color: '#fff',
                  fontSize: 11, fontWeight: 700, textAlign: 'center',
                  padding: '5px', letterSpacing: '0.05em',
                }}>
                  MOST POPULAR
                </div>
              )}

              <div style={{ padding: '16px 16px 0' }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>{plan.icon}</div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--dark)', marginBottom: 2 }}>{plan.name}</div>
                <div style={{ fontSize: 12, color: 'var(--light)', marginBottom: 12 }}>{plan.description}</div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                  {plan.price === 0 ? (
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: plan.color }}>Free</span>
                  ) : (
                    <>
                      <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 700, color: plan.color }}>
                        ${smsAddon && plan.id !== 'free' ? plan.price + 3 : plan.price}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--light)' }}>AUD/mo</span>
                    </>
                  )}
                </div>
                {smsAddon && plan.id !== 'free' && (
                  <div style={{ fontSize: 11, color: 'var(--green)', marginBottom: 8 }}>incl. SMS +$3</div>
                )}

                <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ fontSize: 12, color: 'var(--dark)', display: 'flex', gap: 7 }}>
                      <span style={{ color: plan.color, flexShrink: 0 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>

              <div style={{ padding: '0 16px 16px' }}>
                {isCurrentPlan || plan.isFree ? (
                  <div style={{
                    textAlign: 'center', padding: '9px',
                    background: 'var(--green-light)', borderRadius: 10,
                    fontSize: 12, fontWeight: 600, color: 'var(--green)',
                  }}>
                    {isCurrentPlan ? '✓ Current plan' : 'Always free'}
                  </div>
                ) : (
                  <button
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={loading !== null}
                    style={{
                      width: '100%', padding: '10px',
                      background: isPopular ? plan.color : 'var(--white)',
                      color: isPopular ? '#fff' : plan.color,
                      border: `2px solid ${plan.color}`,
                      borderRadius: 10, fontSize: 13, fontWeight: 600,
                      cursor: loading ? 'not-allowed' : 'pointer',
                      opacity: loading && loading !== plan.id ? 0.5 : 1,
                      transition: 'all 0.15s',
                    }}
                  >
                    {loading === plan.id
                      ? <><span className="spinner" style={{ width: 13, height: 13, borderTopColor: isPopular ? '#fff' : plan.color }} /> Processing…</>
                      : `Start free — 30 days`}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Note */}
      <div style={{ background: 'var(--sand)', borderRadius: 12, padding: '14px 20px', marginBottom: 24, fontSize: 13, color: 'var(--mid)' }}>
        🐾 <strong>1-2 dogs?</strong> iDogs is always free — no credit card, no trial, no expiry.
        SMS reminders available as $3/month add-on on any paid plan.
      </div>

      {/* FAQ */}
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>FAQ</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {[
            { q: 'Is the free plan really free forever?', a: 'Yes — up to 2 dogs is free forever. No credit card required, no expiry.' },
            { q: 'How does the SMS add-on work?', a: 'Add $3/month to any paid plan to receive SMS alerts for upcoming vaccine and worming due dates on your mobile.' },
            { q: 'Can I cancel anytime?', a: 'Yes — cancel anytime from your Stripe billing portal. Your data is kept for 30 days after cancellation.' },
            { q: 'What happens when my trial ends?', a: 'You can continue with a paid plan or downgrade to the free plan (up to 2 dogs). Your data is never deleted.' },
            { q: 'Is my payment secure?', a: 'Yes — payments are processed by Stripe, PCI DSS Level 1 certified. We never store your card details.' },
            { q: 'Can I upgrade or downgrade?', a: 'Yes — switch plans anytime. Upgrades take effect immediately; downgrades apply at the next billing cycle.' },
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
