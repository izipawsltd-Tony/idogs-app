import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'

type DecisionLane = 'AUTO' | 'APPROVAL'

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
  facts: {
    totalUsers: number
    breeders: number
    owners: number
    newUsers7d: number
    newUsers30d: number
    activePaidSubscriptions: number
    estimatedMrrAud: number
    plusEntitledAccounts: number
    internalEntitlementAccounts: number
    freeAccounts: number
    paidAccountSharePct: number
    internalGrantShareOfPlusPct: number
  }
  brief: {
    status: string
    summary: string
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

  const kpis = [
    ['Users', data.facts.totalUsers],
    ['New users · 7d', data.facts.newUsers7d],
    ['Active paid', data.facts.activePaidSubscriptions],
    ['Est. MRR', `A$${data.facts.estimatedMrrAud}`],
    ['Paid account share', `${data.facts.paidAccountSharePct}%`],
    ['Plus entitled', data.facts.plusEntitledAccounts],
  ]

  return (
    <div className="super-admin-page">
      <section className="super-admin-page-title" style={{ marginBottom: 24 }}>
        <p className="super-admin-kicker">AI CEO OS · {data.osVersion}</p>
        <h2>Control Center</h2>
        <p style={{ maxWidth: 860, color: '#53635a' }}>
          {data.objective.northStar}. Phase 1 is read-only: it observes trusted iDogs data,
          turns it into explicit decisions and keeps financial / production risk behind Tony approval.
        </p>
      </section>

      <section className="super-admin-panel" style={{ padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <p className="super-admin-kicker">CEO brief</p>
            <h3 style={{ marginTop: 0 }}>{data.brief.status.replace(/_/g, ' ')}</h3>
            <p style={{ marginBottom: 0, lineHeight: 1.6, color: '#42544a' }}>{data.brief.summary}</p>
          </div>
          <div style={{ minWidth: 260, background: '#f7faf8', border: '1px solid #dfe5df', borderRadius: 10, padding: 14 }}>
            <strong style={{ display: 'block', marginBottom: 6 }}>Operating mode</strong>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: '#53635a' }}>{data.operatingMode.name}</div>
            <div style={{ fontSize: 12, marginTop: 6, color: '#6c7a70' }}>{data.operatingMode.description}</div>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
        {kpis.map(([label, value]) => (
          <div className="super-admin-module-card" key={String(label)}>
            <span>{label}</span>
            <h3 style={{ fontSize: 27, margin: '8px 0 0', color: '#10291d' }}>{value}</h3>
          </div>
        ))}
      </section>

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
                <LaneBadge lane={item.lane} />
              </div>
              <p style={{ lineHeight: 1.6 }}><strong>Decision:</strong> {item.decision}</p>
              <p style={{ lineHeight: 1.6, color: '#53635a' }}><strong>Why:</strong> {item.rationale}</p>
              <div style={{ fontSize: 12, color: '#53635a' }}><strong>KPI:</strong> {item.kpi}</div>
            </article>
          ))}
        </div>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}>
          <p className="super-admin-kicker">Watch</p>
          <h3>Known data gaps</h3>
          {data.watchItems.map(item => (
            <div key={item.id} style={{ padding: '12px 0', borderBottom: '1px solid #edf1ee' }}>
              <strong>{item.title}</strong>
              <p style={{ fontSize: 13, color: '#53635a', lineHeight: 1.5, marginBottom: 0 }}>{item.reason}</p>
            </div>
          ))}
        </section>

        <section className="super-admin-panel" style={{ padding: 20, margin: 0 }}>
          <p className="super-admin-kicker">Approval engine</p>
          <h3>Authority boundaries</h3>
          <p style={{ fontSize: 13, color: '#53635a' }}><strong>AI may prepare / execute reversible work:</strong></p>
          <ul>{data.approvalPolicy.auto.map(item => <li key={item}>{item}</li>)}</ul>
          <p style={{ fontSize: 13, color: '#53635a' }}><strong>Tony approval required:</strong></p>
          <ul>{data.approvalPolicy.approvalRequired.map(item => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>

      <p style={{ marginTop: 18, fontSize: 11, color: '#78867d' }}>
        Generated {new Date(data.generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Adelaide' })} · No autonomous writes or model-provider calls in v1.
      </p>
    </div>
  )
}
