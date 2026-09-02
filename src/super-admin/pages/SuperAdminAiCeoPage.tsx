import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

type DecisionLane = 'AUTO' | 'APPROVAL'
type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'
type Horizon = 'NOW' | 'THIS_WEEK' | 'NEXT_BUILD' | 'WATCH'
type Classification = 'INTERNAL' | 'TEST_QA' | 'LIKELY_REAL' | 'UNCLASSIFIED'

type PriceTruth = {
  id: string
  active: boolean
  livemode: boolean
  currency: string
  amount: number | null
  interval: string | null
  intervalCount: number
} | null

type AccountSignal = {
  uid: string
  email: string | null
  role: string
  classification: Classification
  confidence: Confidence
  reason: string
  dogCount: number
  activeLitterCount: number
  storedPaid: boolean
  stripeStatus: string | null
  stripeMode: string | null
  stripeMrrAud: number | null
}

type Decision = {
  id: string
  lane: DecisionLane
  priority: number
  title: string
  decision: string
  rationale: string
  owner: string
  kpi: string
  evidence: string[]
  nextAction: string
  checkpoint: string
  confidence: Confidence
  financialApprovalRequired: boolean
  score: number
  horizon: Horizon
  scoring: {
    impact: number
    urgency: number
    confidenceWeight: number
    reversibility: number
    cost: number
    formula: string
  }
}

type AiCeoPayload = {
  generatedAt: string
  osVersion: string
  operatingMode: {
    name: string
    autonomousWritesEnabled: boolean
    modelReasoningEnabled: boolean
    stripeReadOnlyVerification: boolean
    description: string
  }
  objective: { northStar: string; constraints: string[] }
  brief: { status: string; summary: string; priorityDecisionId: string }
  revenueTruth: {
    status: 'VERIFIED' | 'PARTIAL' | 'UNAVAILABLE'
    stripeMode: string
    verifiedLiveMrrAud: number
    verifiedTestMrrAud: number
    verifiedLiveActiveSubscriptions: number
    verifiedTestActiveSubscriptions: number
    trialingSubscriptions: number
    pastDueSubscriptions: number
    canceledSubscriptions: number
    storedSubscriptionProfiles: number
    uniqueStoredSubscriptionIds: number
    retrievedSubscriptions: number
    failedSubscriptionReads: number
    nonAudRecurring: Array<{ currency: string; monthlyAmount: number }>
    canonicalPrices: { monthly: PriceTruth; annual: PriceTruth }
    legacyStoredEstimateAud: number
    legacyDeltaAud: number | null
    note: string
  }
  accountClassification: {
    status: string
    internal: number
    testQa: number
    likelyReal: number
    unclassified: number
    likelyRealBreeders: number
    paidLikelyReal: number
    paidInternalOrTest: number
    accounts: AccountSignal[]
    note: string
  }
  facts: {
    totalUsers: number
    breeders: number
    owners: number
    newUsers7d: number
    newUsers30d: number
    plusEntitledAccounts: number
    internalEntitlementAccounts: number
    storedActivePaidSubscriptions: number
    storedActivePaidBreeders: number
    verifiedLivePaidBreeders: number
    totalDogs: number
    activeDogs: number
    transferredDogs: number
    restrictedDogs: number
    archivedDogs: number
    breedersWithDogs: number
    breederDogActivationPct: number
    totalLitters: number
    activeLitters: number
    breedersWithLitters: number
    breederLitterActivationPct: number
    litterActivationFromDogBreedersPct: number
    puppyFunnel: {
      tracked: number
      available: number
      reserved: number
      kept: number
      sold: number
      depositReceived: number
      transferred: number
    }
    showcaseEnquiriesTotal: number
    showcaseEnquiries7d: number
    showcaseEnquiries30d: number
    showcaseNotificationFailures30d: number
    supportConversations: number
    supportNeedsAction: number
    supportUnread: number
    supportOldestOpenDays: number
  }
  decisions: Decision[]
  actionPlan7d: Array<{
    day: number
    date: string
    weekday: string
    focus: string
    owner: string
    lane: DecisionLane
    actions: string[]
    kpi: string
    successCondition: string
    checkpoint: string
  }>
  measurementContract: {
    principle: string
    events: Array<{ event: string; purpose: string; requiredProperties: string[] }>
  }
  watchItems: Array<{ id: string; severity: string; title: string; reason: string }>
  approvalPolicy: { auto: string[]; approvalRequired: string[] }
  sourceNotes: Record<string, string>
}

const panel: React.CSSProperties = { padding: 20, marginBottom: 20 }

function MetricCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="super-admin-module-card" style={{ minHeight: 108 }}>
      <span>{label}</span>
      <h3 style={{ fontSize: 27, margin: '8px 0 3px', color: '#10291d' }}>{value}</h3>
      {note && <p style={{ margin: 0, fontSize: 11, color: '#6c7a70', lineHeight: 1.4 }}>{note}</p>}
    </div>
  )
}

function Pill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const palette = {
    good: { background: '#eef5f0', color: '#1a3a2a' },
    warn: { background: '#fff4e5', color: '#8a4b08' },
    bad: { background: '#fdeeee', color: '#9a2929' },
    neutral: { background: '#f2f4f3', color: '#53635a' },
  }[tone]
  return <span style={{ display: 'inline-flex', padding: '4px 8px', borderRadius: 999, fontSize: 10, fontWeight: 800, letterSpacing: '.035em', ...palette }}>{children}</span>
}

function truthTone(status: string) {
  if (status === 'VERIFIED' || status === 'LIKELY_REAL') return 'good' as const
  if (status === 'UNAVAILABLE' || status === 'UNCLASSIFIED') return 'bad' as const
  return 'warn' as const
}

function horizonTone(horizon: Horizon) {
  if (horizon === 'NOW') return 'bad' as const
  if (horizon === 'THIS_WEEK') return 'warn' as const
  if (horizon === 'NEXT_BUILD') return 'good' as const
  return 'neutral' as const
}

function formatPrice(price: PriceTruth) {
  if (!price || price.amount === null) return 'Unavailable'
  return `${price.currency === 'AUD' ? 'A$' : `${price.currency} `}${price.amount}/${price.interval || 'period'}`
}

export default function SuperAdminAiCeoPage() {
  const { user } = useAuth()
  const [data, setData] = useState<AiCeoPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!user) return
    setLoading(true)
    setError(null)
    try {
      const token = await user.getIdToken()
      const response = await fetch('/api/super-admin/ai-ceo', { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.message || json.error || `HTTP ${response.status}`)
      setData(json)
    } catch (reason: any) {
      setError(reason?.message || 'Failed to load AI CEO Control Center.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [user])

  if (loading) return <div className="super-admin-page"><p>Loading AI CEO reality brief...</p></div>
  if (error || !data) return (
    <div className="super-admin-page"><section className="super-admin-panel" style={panel}>
      <h2>AI CEO Control Center unavailable</h2><p style={{ color: '#a52828' }}>{error || 'No data returned.'}</p>
      <button type="button" className="btn btn-primary" onClick={load}>Retry</button>
    </section></div>
  )

  const priorityDecision = data.decisions.find(item => item.id === data.brief.priorityDecisionId) || data.decisions[0]
  const headline = [
    ['Verified LIVE MRR', `A$${data.revenueTruth.verifiedLiveMrrAud}`, `${data.revenueTruth.verifiedLiveActiveSubscriptions} active LIVE subscription(s)`],
    ['Likely real accounts', data.accountClassification.likelyReal, `${data.accountClassification.unclassified} still unclassified`],
    ['Likely real breeders', data.accountClassification.likelyRealBreeders, `${data.facts.verifiedLivePaidBreeders} verified LIVE paid breeder(s)`],
    ['Raw dog activation', `${data.facts.breederDogActivationPct}%`, `${data.facts.breedersWithDogs}/${data.facts.breeders} breeder-shaped accounts`],
    ['Raw litter activation', `${data.facts.breederLitterActivationPct}%`, `${data.facts.breedersWithLitters}/${data.facts.breeders} breeder-shaped accounts`],
    ['Support needs action', data.facts.supportNeedsAction, `oldest ${data.facts.supportOldestOpenDays} day(s)`],
  ] as const

  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <p className="super-admin-kicker">AI CEO OS · {data.osVersion}</p>
          <h2>Control Center</h2>
          <p style={{ maxWidth: 900, color: '#53635a', lineHeight: 1.55 }}>{data.objective.northStar}. V1.2 prioritises reality before optimisation: LIVE revenue truth, customer-quality signals, dynamic decision scores and a concrete 7-day operating plan.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load}>Refresh reality brief</button>
      </section>

      <section className="super-admin-panel" style={panel}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 20 }}>
          <div>
            <p className="super-admin-kicker">CEO brief</p>
            <h3 style={{ marginTop: 0 }}>{data.brief.status.replaceAll('_', ' ')}</h3>
            <p style={{ lineHeight: 1.65, color: '#42544a' }}>{data.brief.summary}</p>
            {priorityDecision && <div style={{ borderLeft: '4px solid #1a3a2a', background: '#f7faf8', padding: '11px 13px' }}>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 7 }}><Pill tone={horizonTone(priorityDecision.horizon)}>{priorityDecision.horizon.replaceAll('_', ' ')}</Pill><Pill>Score {priorityDecision.score}/100</Pill></div>
              <strong>Priority #1: {priorityDecision.title}</strong>
              <p style={{ margin: '5px 0 0', fontSize: 13, color: '#53635a' }}>{priorityDecision.nextAction}</p>
            </div>}
          </div>
          <div style={{ background: '#f7faf8', border: '1px solid #dfe5df', borderRadius: 10, padding: 16 }}>
            <strong style={{ display: 'block', marginBottom: 7 }}>Operating mode</strong>
            <div style={{ color: '#1a3a2a', fontSize: 13, fontWeight: 800 }}>{data.operatingMode.name}</div>
            <p style={{ color: '#6c7a70', fontSize: 12, lineHeight: 1.5 }}>{data.operatingMode.description}</p>
            <div style={{ fontSize: 12, lineHeight: 1.7 }}>Autonomous writes: <strong>OFF</strong><br />Model reasoning: <strong>OFF</strong><br />Stripe verification: <strong>{data.operatingMode.stripeReadOnlyVerification ? 'READ ONLY' : 'OFF'}</strong></div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        {headline.map(([label, value, note]) => <MetricCard key={label} label={label} value={value} note={note} />)}
      </section>

      <section className="super-admin-panel" style={panel}>
        <p className="super-admin-kicker">Revenue Truth</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><h3 style={{ margin: 0 }}>Stripe-verified recurring revenue</h3><Pill tone={truthTone(data.revenueTruth.status)}>{data.revenueTruth.status}</Pill><Pill>{data.revenueTruth.stripeMode}</Pill></div>
        <p style={{ fontSize: 13, color: '#53635a', lineHeight: 1.6 }}>{data.revenueTruth.note}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <MetricCard label="LIVE MRR" value={`A$${data.revenueTruth.verifiedLiveMrrAud}`} note="Active LIVE recurring Stripe line items only" />
          <MetricCard label="TEST MRR" value={`A$${data.revenueTruth.verifiedTestMrrAud}`} note="Never counted as business revenue" />
          <MetricCard label="Plus Monthly truth" value={formatPrice(data.revenueTruth.canonicalPrices.monthly)} note="Canonical checkout price" />
          <MetricCard label="Plus Annual truth" value={formatPrice(data.revenueTruth.canonicalPrices.annual)} note="Canonical checkout price" />
          <MetricCard label="Legacy estimate" value={`A$${data.revenueTruth.legacyStoredEstimateAud}`} note="Old A$5/A$49 display math — diagnostic only" />
          <MetricCard label="Legacy → LIVE delta" value={data.revenueTruth.legacyDeltaAud === null ? 'Unknown' : `A$${data.revenueTruth.legacyDeltaAud}`} note={`${data.revenueTruth.failedSubscriptionReads} failed Stripe subscription read(s)`} />
        </div>
        <p style={{ marginBottom: 0, marginTop: 12, fontSize: 12, color: '#6c7a70' }}>Stored profiles with subscription IDs: {data.revenueTruth.storedSubscriptionProfiles} · unique IDs: {data.revenueTruth.uniqueStoredSubscriptionIds} · retrieved: {data.revenueTruth.retrievedSubscriptions} · trialing: {data.revenueTruth.trialingSubscriptions} · past due: {data.revenueTruth.pastDueSubscriptions}.</p>
      </section>

      <section className="super-admin-panel" style={panel}>
        <p className="super-admin-kicker">Account reality</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><h3 style={{ margin: 0 }}>Real / test / internal classification signals</h3><Pill tone={truthTone(data.accountClassification.status)}>{data.accountClassification.status}</Pill></div>
        <p style={{ fontSize: 13, color: '#53635a', lineHeight: 1.6 }}>{data.accountClassification.note}</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
          <MetricCard label="LIKELY_REAL" value={data.accountClassification.likelyReal} />
          <MetricCard label="UNCLASSIFIED" value={data.accountClassification.unclassified} />
          <MetricCard label="INTERNAL" value={data.accountClassification.internal} />
          <MetricCard label="TEST_QA" value={data.accountClassification.testQa} />
          <MetricCard label="Paid likely-real" value={data.accountClassification.paidLikelyReal} />
          <MetricCard label="Paid internal/test" value={data.accountClassification.paidInternalOrTest} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860, fontSize: 12 }}>
            <thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #dfe5df' }}><th style={{ padding: 9 }}>Account</th><th>Role</th><th>Classification</th><th>Evidence</th><th>Dogs</th><th>Litters</th><th>Stripe</th><th>MRR</th></tr></thead>
            <tbody>{data.accountClassification.accounts.map(account => <tr key={account.uid} style={{ borderBottom: '1px solid #edf1ee' }}>
              <td style={{ padding: 9, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }} title={account.email || account.uid}>{account.email || account.uid}</td>
              <td>{account.role}</td>
              <td><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}><Pill tone={truthTone(account.classification)}>{account.classification}</Pill><Pill>{account.confidence}</Pill></div></td>
              <td style={{ maxWidth: 290, color: '#53635a' }}>{account.reason}</td><td>{account.dogCount}</td><td>{account.activeLitterCount}</td>
              <td>{account.stripeStatus ? `${account.stripeMode || ''} ${account.stripeStatus}` : '—'}</td><td>{account.stripeMrrAud === null ? '—' : `A$${account.stripeMrrAud}`}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="super-admin-panel" style={panel}>
        <p className="super-admin-kicker">7-Day CEO Action Plan</p><h3>What the company does next — in order</h3>
        <div style={{ display: 'grid', gap: 12 }}>{data.actionPlan7d.map(day => <article key={day.day} style={{ border: '1px solid #dfe5df', borderRadius: 10, padding: 15, display: 'grid', gridTemplateColumns: 'minmax(100px, 140px) minmax(0, 1fr)', gap: 16 }}>
          <div><strong style={{ display: 'block', color: '#10291d' }}>Day {day.day}</strong><span style={{ fontSize: 12, color: '#6c7a70' }}>{day.weekday} · {day.date}</span><div style={{ marginTop: 8 }}><Pill tone={day.lane === 'APPROVAL' ? 'warn' : 'good'}>{day.lane === 'APPROVAL' ? 'TONY APPROVAL' : 'AUTO'}</Pill></div></div>
          <div><h4 style={{ margin: '0 0 5px', color: '#10291d' }}>{day.focus}</h4><div style={{ fontSize: 12, color: '#6c7a70', marginBottom: 7 }}>{day.owner}</div><ul style={{ margin: '6px 0 9px', paddingLeft: 20 }}>{day.actions.map(action => <li key={action} style={{ marginBottom: 4 }}>{action}</li>)}</ul><div style={{ fontSize: 12, lineHeight: 1.55 }}><strong>KPI:</strong> {day.kpi}<br /><strong>Success:</strong> {day.successCondition}<br /><strong>Checkpoint:</strong> {day.checkpoint}</div></div>
        </article>)}</div>
      </section>

      <section className="super-admin-panel" style={panel}>
        <p className="super-admin-kicker">Decision scoring</p><h3>Ranked by business leverage, not hard-coded priority</h3>
        <p style={{ fontSize: 13, color: '#53635a' }}>Formula: <strong>Impact × Urgency × Confidence × Reversibility ÷ Cost</strong>, normalized to 0–100. High score + high urgency moves work toward NOW.</p>
        <div style={{ display: 'grid', gap: 14 }}>{data.decisions.map(item => <article key={item.id} style={{ border: '1px solid #dfe5df', borderRadius: 10, padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}><div><div style={{ fontSize: 12, color: '#6c7a70' }}>Priority #{item.priority} · {item.owner}</div><h4 style={{ margin: '4px 0', fontSize: 17, color: '#10291d' }}>{item.title}</h4></div><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-start' }}><Pill tone={horizonTone(item.horizon)}>{item.horizon.replaceAll('_', ' ')}</Pill><Pill>Score {item.score}/100</Pill><Pill>{item.confidence}</Pill><Pill tone={item.lane === 'APPROVAL' ? 'warn' : 'good'}>{item.lane === 'APPROVAL' ? 'TONY APPROVAL' : 'AUTO'}</Pill></div></div>
          <p style={{ lineHeight: 1.6 }}><strong>Decision:</strong> {item.decision}</p><p style={{ lineHeight: 1.6, color: '#53635a' }}><strong>Why:</strong> {item.rationale}</p>
          <div style={{ background: '#f7faf8', padding: '9px 11px', borderRadius: 8, fontSize: 12, marginBottom: 10 }}><strong>Score inputs:</strong> Impact {item.scoring.impact}/5 · Urgency {item.scoring.urgency}/5 · Confidence {item.confidence} ({item.scoring.confidenceWeight}) · Reversibility {item.scoring.reversibility}/5 · Cost {item.scoring.cost}/5</div>
          <strong style={{ fontSize: 12 }}>Evidence</strong><ul style={{ marginTop: 5 }}>{item.evidence.map(evidence => <li key={evidence} style={{ marginBottom: 4 }}>{evidence}</li>)}</ul>
          <p style={{ fontSize: 13 }}><strong>Next action:</strong> {item.nextAction}</p><p style={{ fontSize: 13, color: '#53635a' }}><strong>Checkpoint:</strong> {item.checkpoint}</p><div style={{ fontSize: 12, color: '#53635a' }}><strong>KPI:</strong> {item.kpi}</div>
        </article>)}</div>
      </section>

      <section className="super-admin-panel" style={panel}>
        <p className="super-admin-kicker">Minimum measurement contract</p><h3>{data.measurementContract.principle}</h3>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ textAlign: 'left', borderBottom: '1px solid #dfe5df' }}><th style={{ padding: 9 }}>Event</th><th>Business purpose</th><th>Required properties</th></tr></thead><tbody>{data.measurementContract.events.map(event => <tr key={event.event} style={{ borderBottom: '1px solid #edf1ee' }}><td style={{ padding: 9 }}><code>{event.event}</code></td><td>{event.purpose}</td><td>{event.requiredProperties.join(', ')}</td></tr>)}</tbody></table></div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, marginBottom: 20 }}>
        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}><p className="super-admin-kicker">Current operations</p><h3>Activation + market signals</h3><p style={{ fontSize: 13, lineHeight: 1.6 }}>Raw breeder-shaped funnel: {data.facts.breeders} registered → {data.facts.breedersWithDogs} with dogs → {data.facts.breedersWithLitters} with active litters → {data.facts.verifiedLivePaidBreeders} LIKELY_REAL LIVE paid breeder(s).</p><p style={{ fontSize: 12, color: '#6c7a70' }}>Dogs: {data.facts.totalDogs} total · {data.facts.activeDogs} active · {data.facts.archivedDogs} archived · {data.facts.transferredDogs} transferred. Litters: {data.facts.activeLitters}/{data.facts.totalLitters} active.</p><p style={{ fontSize: 12, color: '#6c7a70' }}>Showcase enquiries: {data.facts.showcaseEnquiries7d} in 7d · {data.facts.showcaseEnquiries30d} in 30d · {data.facts.showcaseEnquiriesTotal} total. Puppy state: {data.facts.puppyFunnel.available} available · {data.facts.puppyFunnel.reserved} reserved · {data.facts.puppyFunnel.depositReceived} deposit received · {data.facts.puppyFunnel.transferred} transferred.</p></section>
        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}><p className="super-admin-kicker">Watch</p><h3>Truth guards / data gaps</h3>{data.watchItems.map(item => <div key={item.id} style={{ padding: '10px 0', borderBottom: '1px solid #edf1ee' }}><div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}><strong>{item.title}</strong><Pill>{item.severity}</Pill></div><p style={{ fontSize: 12, color: '#53635a', lineHeight: 1.5, marginBottom: 0 }}>{item.reason}</p></div>)}</section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20 }}>
        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}><p className="super-admin-kicker">Approval engine</p><h3>Authority boundaries</h3><p style={{ fontSize: 12 }}><strong>AUTO / reversible:</strong></p><ul>{data.approvalPolicy.auto.map(item => <li key={item}>{item}</li>)}</ul><p style={{ fontSize: 12 }}><strong>Tony approval required:</strong></p><ul>{data.approvalPolicy.approvalRequired.map(item => <li key={item}>{item}</li>)}</ul></section>
        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}><p className="super-admin-kicker">Source truth</p><h3>What each KPI means</h3>{Object.entries(data.sourceNotes).map(([key, value]) => <p key={key} style={{ fontSize: 12, lineHeight: 1.55 }}><strong>{key}:</strong> {value}</p>)}</section>
      </div>

      <p style={{ marginTop: 18, fontSize: 11, color: '#78867d' }}>Generated {new Date(data.generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Adelaide' })} · Stripe verification is read-only · No autonomous writes or model-provider calls in v1.2.</p>
    </div>
  )
}
