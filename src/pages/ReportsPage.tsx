import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { getDogs, getLitters, getHealthTests } from '../lib/db'
import { formatDate } from '../lib/utils'
import {
  litterProduction, healthCoverage, salesAndTransfers,
  type LitterProductionReport, type HealthCoverageReport, type SalesReport,
  type CoverageType,
} from '../lib/reports'
import type { HealthTest, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

const COVERAGE_LABEL: Record<CoverageType, string> = {
  hip: 'Hip', elbow: 'Elbow', eye: 'Eye', dna: 'DNA',
}

function formatMonth(ym: string): string {
  // 'YYYY-MM' → 'Mon YYYY'
  const [y, m] = ym.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
}

export default function ReportsPage({ toast }: Props) {
  const [loading, setLoading] = useState(true)
  const [litter, setLitter] = useState<LitterProductionReport | null>(null)
  const [coverage, setCoverage] = useState<HealthCoverageReport | null>(null)
  const [sales, setSales] = useState<SalesReport | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const [dogs, litters] = await Promise.all([getDogs(), getLitters()])
      const healthArrays = await Promise.all(dogs.map(d => getHealthTests(d.id)))
      const healthByDog = new Map<string, HealthTest[]>(
        dogs.map((d, i) => [d.id, healthArrays[i]]),
      )
      setLitter(litterProduction(litters, dogs))
      setCoverage(healthCoverage(dogs, healthByDog))
      setSales(salesAndTransfers(dogs))
    } catch {
      toast('Failed to load reports', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div style={{ padding: 40, display: 'flex', justifyContent: 'center', alignItems: 'center', flexDirection: 'column', gap: 12 }}>
      <div className="spinner" />
      <p style={{ fontSize: 14, color: 'var(--light)' }}>Loading reports…</p>
    </div>
  )

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Reports</h1>
        <p style={{ fontSize: 14, color: 'var(--light)' }}>An on-the-fly overview of your kennel. Nothing here is stored.</p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <BreedingOverviewStub />
        <LitterProductionSection data={litter} />
        <HealthCoverageSection data={coverage} />
        <SalesSection data={sales} />
      </div>
    </div>
  )
}

// ── shared bits ───────────────────────────────────────────────
function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="card card-shadow">
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--dark)' }}>{title}</h2>
        {subtitle && <p style={{ fontSize: 13, color: 'var(--light)', marginTop: 2 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Stat({ value, label, tone }: { value: string | number; label: string; tone?: 'brand' | 'warning' | 'muted' }) {
  const color = tone === 'brand' ? 'var(--brand-600)' : tone === 'warning' ? 'var(--warning)' : 'var(--dark)'
  return (
    <div style={{ background: 'var(--white)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, textAlign: 'center', minWidth: 0 }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--mid)', marginTop: 4 }}>{label}</div>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p style={{ fontSize: 14, color: 'var(--light)', padding: '8px 0' }}>{text}</p>
}

// ── 4.1 Breeding Overview (stub — pending breedingCompliance.ts) ──
function BreedingOverviewStub() {
  return (
    <SectionCard title="Breeding Overview" subtitle="Eligibility across your current kennel (excludes deceased and transferred dogs).">
      <div style={{ background: 'var(--gray-100)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', padding: '20px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--mid)', marginBottom: 4 }}>Coming in this build</div>
        <div style={{ fontSize: 13, color: 'var(--light)' }}>
          This section reuses your existing breeding rules and will show Eligible / Caution / Review Required once wired up.
        </div>
      </div>
    </SectionCard>
  )
}

// ── 4.2 Litter Production ─────────────────────────────────────
function LitterProductionSection({ data }: { data: LitterProductionReport | null }) {
  if (!data) return null
  const { byYear, rows, expected } = data
  const th: CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--light)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '8px 10px' }
  const td: CSSProperties = { fontSize: 13, color: 'var(--dark)', padding: '10px', borderTop: '1px solid var(--border)' }

  return (
    <SectionCard title="Litter Production" subtitle="Litters, puppy counts and averages by whelp year.">
      {byYear.length === 0 ? (
        <EmptyRow text="No whelped litters yet." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 16 }}>
          {byYear.map(y => (
            <Stat key={y.year} value={y.litterCount} label={`${y.year} · ${y.totalPuppies} pups · avg ${y.avgLitterSize}`} tone="brand" />
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Litter</th><th style={th}>Dam</th><th style={th}>Sire</th><th style={th}>Whelped</th><th style={th}>Puppies</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={td}>{r.name}</td>
                  <td style={td}>{r.damName}</td>
                  <td style={{ ...td, color: r.sireName === 'External sire' ? 'var(--light)' : 'var(--dark)' }}>{r.sireName}</td>
                  <td style={td}>{r.whelpDate ? formatDate(r.whelpDate) : '—'}</td>
                  <td style={td}>{r.puppyCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {expected.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', marginBottom: 6 }}>Expected (not yet whelped)</div>
          {expected.map(r => (
            <div key={r.id} style={{ fontSize: 13, color: 'var(--mid)', padding: '4px 0' }}>{r.name} · Dam: {r.damName}</div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ── 4.3 Health Test Coverage ──────────────────────────────────
function HealthCoverageSection({ data }: { data: HealthCoverageReport | null }) {
  if (!data) return null
  const { eligibleCount, excludedPuppyCount, stats, otherTestsCount } = data

  return (
    <SectionCard
      title="Health Test Coverage"
      subtitle={`Across ${eligibleCount} adult dog${eligibleCount !== 1 ? 's' : ''} (young adult, adult, senior). ${excludedPuppyCount} puppy/puppies excluded.`}
    >
      {eligibleCount === 0 ? (
        <EmptyRow text="No adult dogs to measure coverage on yet." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {stats.map(s => (
            <div key={s.type}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--dark)' }}>{COVERAGE_LABEL[s.type]}</span>
                <span style={{ fontSize: 13, color: 'var(--mid)' }}>{s.covered}/{eligibleCount} · {s.pct}%</span>
              </div>
              <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${s.pct}%`, background: s.pct >= 100 ? 'var(--brand-600)' : s.pct > 0 ? 'var(--brand-300)' : 'var(--border)', borderRadius: 4, transition: 'width .2s' }} />
              </div>
              {s.missing > 0 && (
                <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 2 }}>{s.missing} missing</div>
              )}
            </div>
          ))}
          {otherTestsCount > 0 && (
            <div style={{ fontSize: 12, color: 'var(--light)', marginTop: 2 }}>{otherTestsCount} dog(s) also have cardiac/other tests on file.</div>
          )}
        </div>
      )}
    </SectionCard>
  )
}

// ── 4.4 Sales & Transfers ─────────────────────────────────────
function SalesSection({ data }: { data: SalesReport | null }) {
  if (!data) return null
  const { transfersByMonth, funnel, hasSalesData, transferredRows, reservedRows } = data
  const th: CSSProperties = { textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'var(--light)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '8px 10px' }
  const td: CSSProperties = { fontSize: 13, color: 'var(--dark)', padding: '10px', borderTop: '1px solid var(--border)' }

  return (
    <SectionCard title="Sales & Transfers" subtitle="Ownership transfers and puppy sales funnel.">
      {/* Transfers by month */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', marginBottom: 8 }}>Transfers by month</div>
      {transfersByMonth.length === 0 ? (
        <EmptyRow text="No transfers recorded yet." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 18 }}>
          {transfersByMonth.map(m => <Stat key={m.month} value={m.count} label={formatMonth(m.month)} tone="brand" />)}
        </div>
      )}

      {/* Sales funnel — inert until Puppy lifecycle fields (module #2) land */}
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', margin: '4px 0 8px' }}>Sales funnel</div>
      {!hasSalesData ? (
        <div style={{ background: 'var(--gray-100)', border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', textAlign: 'center', fontSize: 13, color: 'var(--light)' }}>
          No sales data yet — the funnel activates once puppy availability, reservation and deposit tracking are added.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 10, marginBottom: 4 }}>
          <Stat value={funnel.available} label="Available" tone="brand" />
          <Stat value={funnel.reserved} label="Reserved" tone="warning" />
          <Stat value={funnel.depositReceived} label="Deposit in" tone="brand" />
          <Stat value={funnel.sold} label="Sold" tone="brand" />
          <Stat value={funnel.kept} label="Kept" tone="muted" />
        </div>
      )}

      {/* Reserved buyers */}
      {reservedRows.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', marginBottom: 6 }}>Currently reserved</div>
          {reservedRows.map(r => (
            <div key={r.dogId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--dark)', fontWeight: 500 }}>{r.dogName}</span>
              <span style={{ color: 'var(--mid)' }}>{r.reservedForName}{r.reservedAt ? ` · ${formatDate(r.reservedAt)}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Transferred rows */}
      {transferredRows.length > 0 && (
        <div style={{ marginTop: 16, overflowX: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--mid)', marginBottom: 6 }}>Transferred dogs</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Dog</th><th style={th}>Buyer</th><th style={th}>Email</th><th style={th}>Date</th></tr></thead>
            <tbody>
              {transferredRows.map(r => (
                <tr key={r.dogId}>
                  <td style={td}>{r.dogName}</td>
                  <td style={td}>{r.buyerName}</td>
                  <td style={td}>{r.buyerEmail}</td>
                  <td style={td}>{formatDate(r.transferredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}
