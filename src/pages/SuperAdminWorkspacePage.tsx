import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { isSuperAdminEmail } from '../lib/superAdmin'
import {
  fetchSuperAdminWorkspace,
  type SuperAdminSection,
  type SuperAdminWorkspaceData,
} from '../lib/superAdminWorkspace'
import './SuperAdminWorkspacePage.css'

const SECTIONS: Array<{ id: SuperAdminSection; group: string; label: string; description: string; icon: string }> = [
  { id: 'dashboard', group: 'Overview', label: 'Dashboard', description: 'Platform operating overview', icon: '▦' },
  { id: 'organisations', group: 'Management', label: 'Organisations', description: 'Tenant and kennel overview', icon: '⌂' },
  { id: 'users', group: 'Management', label: 'Users', description: 'Platform account overview', icon: '♙' },
  { id: 'subscriptions', group: 'Revenue', label: 'Subscriptions', description: 'Read-only plan overview', icon: '$' },
  { id: 'audit-logs', group: 'Operations', label: 'Audit Logs', description: 'Platform activity trail', icon: '≡' },
]

const PAGE_SIZE = 15

function formatDate(value: string, includeTime = false): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-AU', includeTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' })
}

function PlanBadge({ plan, source }: { plan: string; source?: string }) {
  const label = source === 'internal' ? 'PLUS · INTERNAL' : plan.toUpperCase()
  return <span className={`sa-badge sa-badge--${plan === 'plus' ? 'plus' : 'free'}`}>{label}</span>
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  if (pages <= 1) return null
  return (
    <div className="sa-pagination">
      <button type="button" disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span>Page {page} of {pages}</span>
      <button type="button" disabled={page === pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  )
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <tr><td className="sa-empty-row" colSpan={columns}>{text}</td></tr>
}

export default function SuperAdminWorkspacePage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { section = 'dashboard' } = useParams<{ section: string }>()
  const validSection = SECTIONS.some(item => item.id === section)
  const activeSection = (validSection ? section : 'dashboard') as SuperAdminSection
  const [data, setData] = useState<SuperAdminWorkspaceData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const query = search.trim().toLowerCase()

  const isAdmin = isSuperAdminEmail(user?.email)

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      setData(await fetchSuperAdminWorkspace())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the Super Admin workspace')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authLoading && isAdmin) loadData()
    else if (!authLoading) setLoading(false)
  }, [authLoading, isAdmin])

  useEffect(() => {
    setSearch('')
    setFilter('all')
    setPage(1)
    setMobileNavOpen(false)
  }, [activeSection])

  useEffect(() => {
    setPage(1)
  }, [query, filter])

  const organisations = useMemo(() => (data?.organisations || []).filter(row => {
    const matchesSearch = !query || `${row.name} ${row.ownerName} ${row.email} ${row.state}`.toLowerCase().includes(query)
    return matchesSearch && (filter === 'all' || row.plan === filter)
  }), [data, query, filter])
  const users = useMemo(() => (data?.users || []).filter(row => {
    const matchesSearch = !query || `${row.name} ${row.email} ${row.kennelName} ${row.state}`.toLowerCase().includes(query)
    return matchesSearch && (filter === 'all' || row.role === filter || row.plan === filter)
  }), [data, query, filter])
  const subscriptions = useMemo(() => (data?.subscriptions || []).filter(row => {
    const matchesSearch = !query || `${row.name} ${row.email} ${row.status} ${row.source}`.toLowerCase().includes(query)
    return matchesSearch && (filter === 'all' || row.plan === filter || row.source === filter || row.status === filter)
  }), [data, query, filter])
  const auditLogs = useMemo(() => (data?.auditLogs || []).filter(row => {
    return !query || `${row.actor} ${row.action} ${row.details} ${row.tenantId} ${row.dogId}`.toLowerCase().includes(query)
  }), [data, query])

  function rowsForPage<T>(rows: T[]): T[] {
    return rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  }

  if (authLoading) return <div className="sa-centred"><div className="spinner" /></div>
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`/app/super-admin/${activeSection}`)}`} replace />
  if (!isAdmin) {
    return (
      <main className="sa-access-denied">
        <div className="sa-access-denied__icon">🔒</div>
        <h1>Super Admin only</h1>
        <p>This workspace requires a verified Super Admin account.</p>
        <Link className="btn btn-primary" to="/app/dashboard">Return to iDogs</Link>
      </main>
    )
  }
  if (!validSection) return <Navigate to="/app/super-admin/dashboard" replace />

  const sectionMeta = SECTIONS.find(item => item.id === activeSection)!

  return (
    <div className="sa-shell">
      <header className="sa-mobile-header">
        <button type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen(value => !value)}>☰</button>
        <strong>Super SaaS Admin</strong>
        <Link to="/app/dashboard">Exit</Link>
      </header>

      <aside className={`sa-sidebar ${mobileNavOpen ? 'sa-sidebar--open' : ''}`}>
        <div className="sa-brand">
          <div className="sa-brand__mark">🐾 <span>iDogs</span></div>
          <div><small>SUPER SAAS ADMIN</small><strong>Operations<br />Console</strong></div>
        </div>
        <nav aria-label="Super Admin navigation">
          {Array.from(new Set(SECTIONS.map(item => item.group))).map(group => (
            <div className="sa-nav-group" key={group}>
              <div className="sa-nav-group__label">{group}</div>
              {SECTIONS.filter(item => item.group === group).map(item => (
                <Link key={item.id} to={`/app/super-admin/${item.id}`} className={item.id === activeSection ? 'active' : ''}>
                  <span className="sa-nav-icon">{item.icon}</span>
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="sa-sidebar__footer">
          <Link to="/app/admin/landing-media">Landing Page Media</Link>
          <Link to="/app/dashboard">← Return to iDogs</Link>
        </div>
      </aside>

      {mobileNavOpen && <button className="sa-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main className="sa-main">
        <div className="sa-topbar">
          <div><small>IDOGS PLATFORM ADMINISTRATION</small><strong>Super SaaS Admin</strong></div>
          <div><small>SIGNED IN AS</small><strong>{user.email}</strong></div>
        </div>

        <div className="sa-content">
          <div className="sa-page-heading">
            <div>
              <small>{sectionMeta.group.toUpperCase()}</small>
              <h1>{activeSection === 'dashboard' ? 'Operational Dashboard' : sectionMeta.label}</h1>
              <p>{sectionMeta.description}. Read-only Phase 1.</p>
            </div>
            <div className="sa-refresh">
              <span>{data ? `Refreshed: ${formatDate(data.generatedAt, true)}` : 'Not refreshed'}</span>
              <button type="button" onClick={loadData} disabled={loading}>↻ Refresh</button>
            </div>
          </div>

          {error && <div className="sa-error" role="alert"><strong>Could not load data.</strong> {error} <button type="button" onClick={loadData}>Try again</button></div>}
          {loading ? <div className="sa-centred"><div className="spinner" /></div> : data && (
            <>
              {activeSection === 'dashboard' && <Dashboard data={data} navigate={navigate} />}
              {activeSection === 'organisations' && (
                <SectionTable title="Organisations" count={organisations.length} search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} filters={['all', 'free', 'plus']}>
                  <div className="sa-table-wrap"><table><thead><tr><th>Organisation</th><th>Owner</th><th>State</th><th>Dogs</th><th>Plan</th><th>Joined</th></tr></thead><tbody>
                    {rowsForPage(organisations).map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.email}</small></td><td>{row.ownerName}</td><td>{row.state || '—'}</td><td>{row.dogCount}</td><td><PlanBadge plan={row.plan} /></td><td>{formatDate(row.createdAt)}</td></tr>)}
                    {!organisations.length && <EmptyRow columns={6} text="No organisations match this search." />}
                  </tbody></table></div><Pagination page={page} total={organisations.length} onChange={setPage} />
                </SectionTable>
              )}
              {activeSection === 'users' && (
                <SectionTable title="Platform users" count={users.length} search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} filters={['all', 'owner', 'breeder', 'free', 'plus']}>
                  <div className="sa-table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>State</th><th>Plan</th><th>Status</th><th>Registered</th></tr></thead><tbody>
                    {rowsForPage(users).map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.email}</small></td><td className="sa-capitalize">{row.role}</td><td>{row.state || '—'}</td><td><PlanBadge plan={row.plan} source={row.planSource} /></td><td>{row.subscriptionStatus || '—'}</td><td>{formatDate(row.createdAt)}</td></tr>)}
                    {!users.length && <EmptyRow columns={6} text="No users match this search." />}
                  </tbody></table></div><Pagination page={page} total={users.length} onChange={setPage} />
                </SectionTable>
              )}
              {activeSection === 'subscriptions' && (
                <SectionTable title="Subscriptions and entitlements" count={subscriptions.length} search={search} onSearch={setSearch} filter={filter} onFilter={setFilter} filters={['all', 'free', 'plus', 'stripe', 'internal']}>
                  <div className="sa-table-wrap"><table><thead><tr><th>Account</th><th>Plan</th><th>Source</th><th>Status</th><th>Interval</th><th>MRR</th></tr></thead><tbody>
                    {rowsForPage(subscriptions).map(row => <tr key={row.userId}><td><strong>{row.name}</strong><small>{row.email}</small></td><td><PlanBadge plan={row.plan} /></td><td className="sa-capitalize">{row.source}</td><td>{row.status}</td><td className="sa-capitalize">{row.interval || '—'}</td><td>${row.mrrAud.toFixed(2)}</td></tr>)}
                    {!subscriptions.length && <EmptyRow columns={6} text="No subscriptions match this search." />}
                  </tbody></table></div><Pagination page={page} total={subscriptions.length} onChange={setPage} />
                </SectionTable>
              )}
              {activeSection === 'audit-logs' && (
                <SectionTable title="Recent platform activity" count={auditLogs.length} search={search} onSearch={setSearch} filter="all" onFilter={() => {}} filters={[]}>
                  <div className="sa-table-wrap"><table><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>
                    {rowsForPage(auditLogs).map(row => <tr key={row.id}><td>{formatDate(row.timestamp, true)}</td><td>{row.actor}</td><td><span className="sa-action">{row.action.replace(/_/g, ' ')}</span></td><td className="sa-detail">{row.details || '—'}</td></tr>)}
                    {!auditLogs.length && <EmptyRow columns={4} text="No activity matches this search." />}
                  </tbody></table></div><Pagination page={page} total={auditLogs.length} onChange={setPage} />
                </SectionTable>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function SectionTable({ title, count, search, onSearch, filter, onFilter, filters, children }: {
  title: string; count: number; search: string; onSearch: (value: string) => void
  filter: string; onFilter: (value: string) => void; filters: string[]; children: React.ReactNode
}) {
  return (
    <section className="sa-panel">
      <div className="sa-panel__toolbar">
        <div><h2>{title}</h2><span>{count} records</span></div>
        <div className="sa-controls">
          <input aria-label={`Search ${title}`} placeholder="Search…" value={search} onChange={event => onSearch(event.target.value)} />
          {!!filters.length && <select aria-label={`Filter ${title}`} value={filter} onChange={event => onFilter(event.target.value)}>{filters.map(item => <option value={item} key={item}>{item === 'all' ? 'All' : item[0].toUpperCase() + item.slice(1)}</option>)}</select>}
        </div>
      </div>
      {children}
    </section>
  )
}

function Dashboard({ data, navigate }: { data: SuperAdminWorkspaceData; navigate: ReturnType<typeof useNavigate> }) {
  const metrics = data.metrics
  const cards = [
    ['Organisations', metrics.organisations.toString(), 'One breeder account = one tenant'],
    ['Total users', metrics.totalUsers.toString(), `Breeders: ${metrics.breeders} · Owners: ${metrics.owners}`],
    ['Paid subscriptions', metrics.paidSubscriptions.toString(), 'Stripe-backed Plus subscriptions'],
    ['Estimated MRR', `$${metrics.mrrAud.toFixed(2)}`, 'AUD · Stripe subscriptions only'],
    ['Active trials', metrics.activeTrials.toString(), 'Trial end date is still in the future'],
    ['Churn rate', metrics.churnRate === null ? 'Not available' : `${metrics.churnRate}%`, 'Requires subscription cohort history'],
  ]
  return (
    <>
      <div className="sa-metrics">{cards.map(([label, value, hint]) => <div className="sa-metric" key={label}><small>{label}</small><strong>{value}</strong><span>{hint}</span></div>)}</div>
      <div className="sa-dashboard-grid">
        <section className="sa-panel">
          <div className="sa-panel__heading"><div><small>SECURITY LOGS</small><h2>Recent Platform Activity</h2></div><button onClick={() => navigate('/app/super-admin/audit-logs')}>View all</button></div>
          <div className="sa-table-wrap"><table><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>
            {data.auditLogs.slice(0, 8).map(row => <tr key={row.id}><td>{formatDate(row.timestamp, true)}</td><td>{row.actor}</td><td><span className="sa-action">{row.action.replace(/_/g, ' ')}</span></td><td className="sa-detail">{row.details || '—'}</td></tr>)}
            {!data.auditLogs.length && <EmptyRow columns={4} text="No platform activity available." />}
          </tbody></table></div>
        </section>
        <section className="sa-panel">
          <div className="sa-panel__heading"><div><small>ACCOUNTS</small><h2>Recent User Signups</h2></div><button onClick={() => navigate('/app/super-admin/users')}>View all</button></div>
          <div className="sa-table-wrap"><table><thead><tr><th>Registered</th><th>Email address</th><th>Role</th><th>Plan</th></tr></thead><tbody>
            {data.users.slice(0, 8).map(row => <tr key={row.id}><td>{formatDate(row.createdAt, true)}</td><td><strong>{row.email}</strong></td><td className="sa-capitalize">{row.role}</td><td><PlanBadge plan={row.plan} source={row.planSource} /></td></tr>)}
            {!data.users.length && <EmptyRow columns={4} text="No users available." />}
          </tbody></table></div>
        </section>
      </div>
    </>
  )
}
