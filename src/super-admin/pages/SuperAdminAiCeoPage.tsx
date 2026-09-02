import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

type DecisionLane = 'AUTO' | 'APPROVAL'
type DecisionConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

type PuppyFunnel = {
  tracked: number
  available: number
  reserved: number
  kept: number
  sold: number
  depositReceived: number
  transferred: number
}

type AiCeoPayload = {
  generatedAt: string
  osVersion: string
  operatingMode: {
    name: string
    autonomousWritesEnabled: boolean
    modelReasoningEnabled: boolean
    description: string
  }
  objective: {
    northStar: string
    constraints: string[]
  }
  decisionFramework: string[]
  facts: {
    totalUsers: number
    breeders: number
    owners: number
    newUsers7d: number
    newUsers30d: number
    activePaidSubscriptions: number
    activePaidBreeders: number
    estimatedMrrAud: number
    plusEntitledAccounts: number
    internalEntitlementAccounts: number
    freeAccounts: number
    paidAccountSharePct: number
    paidBreederSharePct: number
    internalGrantShareOfPlusPct: number
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
    puppyFunnel: PuppyFunnel
    showcaseEnquiriesTotal: number
    showcaseEnquiries7d: number
    showcaseEnquiries30d: number
    showcaseNotificationFailures30d: number
    supportConversations: number
    supportNeedsAction: number
    supportUnread: number
    supportOldestOpenDays: number
  }
  brief: {
    status: string
    summary: string
    priorityDecisionId: string
  }
  decisions: Array<{
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
    confidence: DecisionConfidence
    reversible: boolean
    financialApprovalRequired: boolean
  }>
  watchItems: Array<{
    id: string
    severity: string
    title: string
    reason: string
  }>
  approvalPolicy: {
    auto: string[]
    approvalRequired: string[]
  }
  sourceNotes: Record<string, string>
}

function LaneBadge({ lane }: { lane: DecisionLane }) {
  const approval = lane === 'APPROVAL'
  return (
    <span style={{
      display: 'inline-flex',
      padding: '4px 8px',
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '.04em',
      background: approval ? '#fff4e5' : '#eef5f0',
      color: approval ? '#8a4b08' : '#1a3a2a',
    }}>
      {approval ? 'TONY APPROVAL' : 'AUTO'}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: DecisionConfidence }) {
  return (
    <span style={{
      display: 'inline-flex',
      padding: '3px 7px',
      borderRadius: 6,
      fontSize: 10,
      fontWeight: 700,
      background: '#f4f6f5',
      color: '#53635a',
    }}>
      {confidence} CONFIDENCE
    </span>
  )
}

function MetricCard({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="super-admin-module-card" style={{ minHeight: 112 }}>
      <span>{label}</span>
      <h3 style={{ fontSize: 27, margin: '8px 0 3px', color: '#10291d' }}>{value}</h3>
      {note && <p style={{ margin: 0, fontSize: 11, color: '#6c7a70', lineHeight: 1.4 }}>{note}</p>}
    </div>
  )
}

function FunnelStage({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div style={{ border: '1px solid #dfe5df', borderRadius: 10, padding: 14, background: '#fff' }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#6c7a70', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</span>
      <strong style={{ display: 'block', fontSize: 25, color: '#10291d', margin: '6px 0 2px' }}>{value}</strong>
      <small style={{ color: '#6c7a70' }}>{detail}</small>
    </div>
  )
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
      const res = await fetch('/api/super-admin/ai-ceo', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.message || json.error || `HTTP ${res.status}`)
      setData(json)
    } catch (err: any) {
      setError(err.message || 'Failed to load AI CEO Control Center.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [user])

  if (loading) {
    return <div className="super-admin-page"><p>Loading AI CEO operating brief...</p></div>
  }

  if (error || !data) {
    return (
      <div className="super-admin-page">
        <div className="super-admin-panel" style={{ padding: 24 }}>
          <h2>AI CEO Control Center unavailable</h2>
          <p style={{ color: '#a52828' }}>{error || 'No data returned.'}</p>
          <button type="button" className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      </div>
    )
  }

  const headlineKpis: Array<[string, string | number, string]> = [
    ['Users', data.facts.totalUsers, `${data.facts.newUsers7d} new in 7d`],
    ['Breeder dog activation', `${data.facts.breederDogActivationPct}%`, `${data.facts.breedersWithDogs}/${data.facts.breeders} breeders`],
    ['Breeder litter activation', `${data.facts.breederLitterActivationPct}%`, `${data.facts.breedersWithLitters}/${data.facts.breeders} breeders`],
    ['Active paid', data.facts.activePaidSubscriptions, `${data.facts.paidBreederSharePct}% of breeders`],
    ['Est. MRR', `A$${data.facts.estimatedMrrAud}`, 'Stored billing fields; not live Stripe'],
    ['Support needs action', data.facts.supportNeedsAction, `${data.facts.supportUnread} unread`],
  ]

  const priorityDecision = data.decisions.find(item => item.id === data.brief.priorityDecisionId)

  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <p className="super-admin-kicker">AI CEO OS · {data.osVersion}</p>
          <h2>Control Center</h2>
          <p style={{ maxWidth: 880, color: '#53635a', lineHeight: 1.55 }}>
            {data.objective.northStar}. The CEO layer observes trusted iDogs operating data,
            decides what deserves attention and keeps financial / production risk behind Tony approval.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load}>Refresh CEO brief</button>
      </section>

      <section className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 360px)', gap: 20 }}>
          <div>
            <p className="super-admin-kicker">CEO brief</p>
            <h3 style={{ marginTop: 0 }}>{data.brief.status.replace(/_/g, ' ')}</h3>
            <p style={{ marginBottom: 12, lineHeight: 1.65, color: '#42544a' }}>{data.brief.summary}</p>
            {priorityDecision && (
              <div style={{ borderLeft: '4px solid #1a3a2a', padding: '10px 12px', background: '#f7faf8' }}>
                <strong>Priority #1: {priorityDecision.title}</strong>
                <p style={{ margin: '5px 0 0', fontSize: 13, color: '#53635a' }}>{priorityDecision.nextAction}</p>
              </div>
            )}
          </div>
          <div style={{ background: '#f7faf8', border: '1px solid #dfe5df', borderRadius: 10, padding: 16 }}>
            <strong style={{ display: 'block', marginBottom: 6 }}>Operating mode</strong>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a3a2a' }}>{data.operatingMode.name}</div>
            <div style={{ fontSize: 12, marginTop: 7, color: '#6c7a70', lineHeight: 1.5 }}>{data.operatingMode.description}</div>
            <div style={{ marginTop: 10, fontSize: 12 }}>
              Autonomous writes: <strong>{data.operatingMode.autonomousWritesEnabled ? 'ON' : 'OFF'}</strong><br />
              Model reasoning: <strong>{data.operatingMode.modelReasoningEnabled ? 'ON' : 'OFF'}</strong>
            </div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        {headlineKpis.map(([label, value, note]) => <MetricCard key={label} label={label} value={value} note={note} />)}
      </section>

      <section className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <p className="super-admin-kicker">Activation</p>
        <h3>Breeder operating funnel</h3>
        <p style={{ fontSize: 13, color: '#53635a' }}>Current account-state indicators. These are not historical cohort conversion rates.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <FunnelStage label="Registered breeders" value={data.facts.breeders} detail="Breeder-shaped accounts" />
          <FunnelStage label="With dogs" value={data.facts.breedersWithDogs} detail={`${data.facts.breederDogActivationPct}% of breeders`} />
          <FunnelStage label="With active litters" value={data.facts.breedersWithLitters} detail={`${data.facts.litterActivationFromDogBreedersPct}% of dog-active breeders`} />
          <FunnelStage label="Stored active paid" value={data.facts.activePaidBreeders} detail={`${data.facts.paidBreederSharePct}% of breeders`} />
        </div>
        <div style={{ marginTop: 14, fontSize: 12, color: '#6c7a70' }}>
          Dogs: {data.facts.totalDogs} total · {data.facts.activeDogs} active · {data.facts.restrictedDogs} restricted · {data.facts.archivedDogs} archived · {data.facts.transferredDogs} transferred. Litters: {data.facts.activeLitters} active / {data.facts.totalLitters} total.
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20, marginBottom: 20 }}>
        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}>
          <p className="super-admin-kicker">Revenue workflow</p>
          <h3>Puppy commercial funnel</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <MetricCard label="Tracked puppies" value={data.facts.puppyFunnel.tracked} />
            <MetricCard label="Available" value={data.facts.puppyFunnel.available} />
            <MetricCard label="Reserved" value={data.facts.puppyFunnel.reserved} />
            <MetricCard label="Deposit received" value={data.facts.puppyFunnel.depositReceived} />
            <MetricCard label="Sold" value={data.facts.puppyFunnel.sold} />
            <MetricCard label="Transferred" value={data.facts.puppyFunnel.transferred} />
          </div>
          <p style={{ fontSize: 12, color: '#6c7a70', lineHeight: 1.5, marginBottom: 0 }}>
            Current Dog state only; it does not reconstruct historical sales cohorts. Kept: {data.facts.puppyFunnel.kept}.
          </p>
        </section>

        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}>
          <p className="super-admin-kicker">Demand + customer operations</p>
          <h3>Market and support signals</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <MetricCard label="Showcase enquiries · 7d" value={data.facts.showcaseEnquiries7d} />
            <MetricCard label="Showcase enquiries · 30d" value={data.facts.showcaseEnquiries30d} />
            <MetricCard label="Support needs action" value={data.facts.supportNeedsAction} />
            <MetricCard label="Admin unread" value={data.facts.supportUnread} />
          </div>
          <p style={{ fontSize: 12, color: '#6c7a70', lineHeight: 1.5 }}>
            Total Showcase enquiries: {data.facts.showcaseEnquiriesTotal}. Notification not confirmed on {data.facts.showcaseNotificationFailures30d} enquiry(s) in 30d.
          </p>
          <p style={{ fontSize: 12, color: '#6c7a70', lineHeight: 1.5, marginBottom: 0 }}>
            Oldest support conversation requiring action: {data.facts.supportOldestOpenDays} day(s). Support read is capped at the same 100-conversation window as the existing Super Admin inbox.
          </p>
        </section>
      </div>

      <section className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <p className="super-admin-kicker">Decision queue</p>
        <h3>What the CEO OS recommends now</h3>
        <div style={{ display: 'grid', gap: 14 }}>
          {data.decisions.map(item => (
            <article key={item.id} style={{ border: '1px solid #dfe5df', borderRadius: 10, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#6c7a70', marginBottom: 5 }}>Priority #{item.priority} · {item.owner}</div>
                  <h4 style={{ margin: 0, fontSize: 17, color: '#10291d' }}>{item.title}</h4>
                </div>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                  <ConfidenceBadge confidence={item.confidence} />
                  <LaneBadge lane={item.lane} />
                </div>
              </div>
              <p style={{ lineHeight: 1.6 }}><strong>Decision:</strong> {item.decision}</p>
              <p style={{ lineHeight: 1.6, color: '#53635a' }}><strong>Why:</strong> {item.rationale}</p>
              <div style={{ background: '#f7faf8', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                <strong style={{ fontSize: 12 }}>Evidence</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: '#53635a' }}>
                  {item.evidence.map(line => <li key={line} style={{ marginBottom: 4 }}>{line}</li>)}
                </ul>
              </div>
              <p style={{ fontSize: 13, lineHeight: 1.55 }}><strong>Next action:</strong> {item.nextAction}</p>
              <p style={{ fontSize: 13, lineHeight: 1.55, color: '#53635a' }}><strong>Checkpoint:</strong> {item.checkpoint}</p>
              <div style={{ fontSize: 12, color: '#53635a' }}><strong>KPI:</strong> {item.kpi}</div>
            </article>
          ))}
        </div>
      </section>

      <section className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <p className="super-admin-kicker">Decision framework</p>
        <h3>How the CEO OS reaches a decision</h3>
        <ol style={{ paddingLeft: 20, lineHeight: 1.65, color: '#42544a' }}>
          {data.decisionFramework.map(step => <li key={step} style={{ marginBottom: 5 }}>{step}</li>)}
        </ol>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}>
          <p className="super-admin-kicker">Watch</p>
          <h3>Known data gaps / scale watches</h3>
          {data.watchItems.map(item => (
            <div key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid #edf1ee' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <strong>{item.title}</strong>
                <small style={{ padding: '2px 6px', background: '#f4f6f5', borderRadius: 5, color: '#6c7a70' }}>{item.severity}</small>
              </div>
              <p style={{ fontSize: 13, color: '#53635a', lineHeight: 1.5, marginBottom: 0 }}>{item.reason}</p>
            </div>
          ))}
        </section>

        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}>
          <p className="super-admin-kicker">Approval engine</p>
          <h3>Authority boundaries</h3>
          <p style={{ fontSize: 13, color: '#53635a' }}><strong>AI may prepare / execute reversible work inside guardrails:</strong></p>
          <ul style={{ lineHeight: 1.55 }}>{data.approvalPolicy.auto.map(item => <li key={item}>{item}</li>)}</ul>
          <p style={{ fontSize: 13, color: '#53635a' }}><strong>Tony approval required:</strong></p>
          <ul style={{ lineHeight: 1.55 }}>{data.approvalPolicy.approvalRequired.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>

      <section className="super-admin-panel" style={{ padding: 16, marginTop: 20 }}>
        <p className="super-admin-kicker">Source truth</p>
        <div style={{ display: 'grid', gap: 7 }}>
          {Object.entries(data.sourceNotes).map(([key, value]) => (
            <div key={key} style={{ fontSize: 12, lineHeight: 1.5, color: '#53635a' }}><strong style={{ textTransform: 'capitalize' }}>{key}:</strong> {value}</div>
          ))}
        </div>
      </section>

      <p style={{ marginTop: 18, fontSize: 11, color: '#78867d' }}>
        Generated {new Date(data.generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Adelaide' })} · No autonomous writes or model-provider calls in v1.1.
      </p>
    </div>
  )
}
