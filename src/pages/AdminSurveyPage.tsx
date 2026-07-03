import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { collection, getDocs, query, orderBy, updateDoc, doc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import type { ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

interface SurveyResponse {
  id: string
  name: string
  email: string
  state: string
  ankc: string
  dogCount: string
  litterCount: string
  tools: string[]
  toolsOther: string
  headache: string
  missingRecords: string
  wtp: string
  softwareBefore: string
  softwareWhich: string
  source: string
  status: 'pending' | 'approved' | 'code_sent'
  promoCode: string | null
  createdAt: any
}

const PROMO_CODE = 'EARLYBREEDER3M'
const ADMIN_EMAIL = 'trunghieungo@gmail.com'

export default function AdminSurveyPage({ toast }: Props) {
  const { user } = useAuth()
  const [responses, setResponses] = useState<SurveyResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'code_sent'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)

  // Admin only
  if (user?.email !== ADMIN_EMAIL) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>Admin only</div>
      </div>
    )
  }

  useEffect(() => {
    loadResponses()
  }, [])

  async function loadResponses() {
    setLoading(true)
    try {
      const q = query(collection(db, 'surveyResponses'), orderBy('createdAt', 'desc'))
      const snap = await getDocs(q)
      setResponses(snap.docs.map(d => ({ ...d.data(), id: d.id } as SurveyResponse)))
    } catch {
      toast('Failed to load responses', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function sendPromoCode(response: SurveyResponse) {
    setSending(response.id)
    try {
      // Send email with promo code
      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: response.email,
          subject: '🎁 Your 3-month free promo code for iDogs',
          html: `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto">
              <div style="background:#2E7D4E;padding:24px;border-radius:12px 12px 0 0;text-align:center">
                <span style="font-size:32px">🐾</span>
                <h1 style="color:#fff;font-size:22px;margin:8px 0 0">Your promo code is here!</h1>
              </div>
              <div style="background:#fff;padding:28px;border:1px solid #E2DFD8;border-top:none;border-radius:0 0 12px 12px">
                <p style="color:#5C5A54;font-size:15px;line-height:1.6">Hi ${response.name},</p>
                <p style="color:#5C5A54;font-size:15px;line-height:1.6">
                  Thank you so much for your valuable feedback. Here is your <strong>3-month free promo code</strong>:
                </p>
                <div style="background:#F3F8F4;border:2px dashed #2E7D4E;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
                  <div style="font-size:28px;font-weight:700;color:#2E7D4E;letter-spacing:0.1em">${PROMO_CODE}</div>
                  <div style="font-size:13px;color:#5C5A54;margin-top:6px">3 months free on any paid plan · Expires Dec 31, 2026</div>
                </div>
                <p style="color:#5C5A54;font-size:14px;line-height:1.6">
                  <strong>How to use:</strong><br/>
                  1. <a href="https://idogs.com.au/signup" style="color:#2E7D4E">Create your free account</a> (or log in)<br/>
                  2. Go to Billing → choose a plan<br/>
                  3. Enter code <strong>${PROMO_CODE}</strong> at checkout
                </p>
                <p style="color:#5C5A54;font-size:14px;line-height:1.6">
                  I would also love to have a 20-minute call to learn more about your breeding workflow. 
                  Would you be open to that? Simply reply to this email and we will find a time.
                </p>
                <p style="color:#9A9891;font-size:13px;margin-top:24px">
                  Tony Ngo<br/>
                  Founder, iDogs · iziPaws Pty Ltd<br/>
                  info@izipaws.com.au
                </p>
              </div>
            </div>
          `,
        }),
      })

      // Update Firestore status
      await updateDoc(doc(db, 'surveyResponses', response.id), {
        status: 'code_sent',
        promoCode: PROMO_CODE,
      })

      setResponses(prev => prev.map(r => r.id === response.id ? { ...r, status: 'code_sent', promoCode: PROMO_CODE } : r))
      toast(`Promo code sent to ${response.email} ✓`, 'success')
    } catch {
      toast('Failed to send promo code', 'error')
    } finally {
      setSending(null)
    }
  }

  const filtered = responses.filter(r => filter === 'all' || r.status === filter)

  const stats = {
    total: responses.length,
    pending: responses.filter(r => r.status === 'pending').length,
    sent: responses.filter(r => r.status === 'code_sent').length,
    nsw: responses.filter(r => r.state === 'NSW').length,
    ankc: responses.filter(r => r.ankc === 'Yes').length,
  }

  if (loading) return <div style={{ padding: 40, display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>
          Survey Responses
        </h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>Market validation data from breeder feedback survey.</p>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total', value: stats.total, color: 'var(--dark)' },
          { label: 'Pending review', value: stats.pending, color: 'var(--gold)' },
          { label: 'Code sent', value: stats.sent, color: 'var(--green)' },
          { label: 'NSW breeders', value: stats.nsw, color: '#2E7D4E' },
          { label: 'Dogs Australia registered', value: stats.ankc, color: '#6BAE7B' },
        ].map(stat => (
          <div key={stat.label} style={{ background: 'var(--white)', borderRadius: 12, padding: '16px', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: stat.color }}>{stat.value}</div>
            <div style={{ fontSize: 12, color: 'var(--light)', marginTop: 4 }}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['all', 'pending', 'approved', 'code_sent'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: 'pointer',
              border: `1.5px solid ${filter === f ? 'var(--green)' : 'var(--border)'}`,
              background: filter === f ? 'var(--green-light)' : 'var(--white)',
              color: filter === f ? 'var(--green)' : 'var(--mid)' }}>
            {f === 'all' ? 'All' : f === 'code_sent' ? 'Code sent' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Responses list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--light)', fontSize: 14 }}>
          No responses yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(r => (
            <div key={r.id} style={{ background: 'var(--white)', borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
              {/* Row header */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '14px 16px', gap: 12, cursor: 'pointer' }}
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dark)' }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--light)' }}>{r.email} · {r.state} · {r.dogCount} dogs · {r.litterCount} litters/yr</div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
                  {r.ankc === 'Yes' && <span style={{ fontSize: 11, background: 'var(--green-light)', color: 'var(--green)', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>Dogs Australia</span>}
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 10, fontWeight: 600,
                    background: r.status === 'pending' ? 'var(--gold-light)' : r.status === 'code_sent' ? 'var(--green-light)' : 'var(--sand)',
                    color: r.status === 'pending' ? 'var(--gold)' : r.status === 'code_sent' ? 'var(--green)' : 'var(--mid)' }}>
                    {r.status === 'pending' ? '⏳ Pending' : r.status === 'code_sent' ? '✓ Code sent' : '✓ Approved'}
                  </span>
                  {r.status === 'pending' && (
                    <button className="btn btn-primary btn-sm"
                      onClick={e => { e.stopPropagation(); sendPromoCode(r) }}
                      disabled={sending === r.id}
                      style={{ fontSize: 12, padding: '5px 12px' }}>
                      {sending === r.id ? <span className="spinner" style={{ width: 12, height: 12, borderTopColor: '#fff' }} /> : '🎁 Send code'}
                    </button>
                  )}
                </div>
              </div>

              {/* Expanded detail */}
              {expanded === r.id && (
                <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--sand)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                    {[
                      { label: 'Tools used', value: [...(r.tools || []), r.toolsOther].filter(Boolean).join(', ') },
                      { label: 'Software before', value: r.softwareBefore + (r.softwareWhich ? ` — ${r.softwareWhich}` : '') },
                      { label: 'Missing records issue', value: r.missingRecords },
                      { label: 'WTP (2hrs saved/week)', value: r.wtp },
                      { label: 'Biggest headache', value: r.headache },
                    ].map(item => (
                      <div key={item.label} style={{ background: 'var(--sand)', borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--light)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>{item.label}</div>
                        <div style={{ fontSize: 13, color: 'var(--dark)', lineHeight: 1.5 }}>{item.value || '—'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
