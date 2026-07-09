import React, { useEffect, useState, useRef } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { getDogs, getLitters, updateUserProfile, claimTransferredDogs } from '../../lib/db'
import { getInitials, AU_STATES } from '../../lib/utils'
import { Link } from 'react-router-dom'
import type { ToastMessage, UserProfile } from '../../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

// ── Super Admin allowlist for Option B Console link ──
const SUPER_ADMIN_EMAILS = [
  'trunghieungo@gmail.com',
  'theresanguyenngo@gmail.com',
]

// ── Plan configuration ──
const PLAN_CONFIG: Record<string, { label: string; dogLimit: number; upgrade: boolean }> = {
  free:         { label: 'Free Plan',    dogLimit: 2,    upgrade: true },
  trial:        { label: 'Free Trial',   dogLimit: 2,    upgrade: true },
  starter:      { label: 'Basic Plan',   dogLimit: 10,   upgrade: true },
  basic:        { label: 'Basic Plan',   dogLimit: 10,   upgrade: true },
  pro:          { label: 'Pro Plan',     dogLimit: 20,   upgrade: true },
  professional: { label: 'Pro Plan',     dogLimit: 20,   upgrade: true },
  kennel:       { label: 'Kennel Plan',  dogLimit: 9999, upgrade: false },
}

function getPlanCfg(plan?: string) {
  return PLAN_CONFIG[plan ?? 'free'] ?? PLAN_CONFIG['free']
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function formatTodayLong() {
  return new Date().toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ── Nav structure ──
type NavItemDef = {
  path: string
  label: string
  icon: string
  comingSoon?: boolean
  littersItem?: boolean
  documentsItem?: boolean
  remindersItem?: boolean
}

const NAV_SECTIONS: { label: string; items: NavItemDef[] }[] = [
  {
    label: 'MAIN',
    items: [
      { path: '/app/dashboard', label: 'Dashboard', icon: '⊞' },
      { path: '/app/dogs',      label: 'My Dogs',   icon: '🐕' },
      { path: '/app/litters',   label: 'Litters',   icon: '🐣', littersItem: true },
    ],
  },
  {
    label: 'BREEDING',
    items: [
      { path: '/app/dogs?stage=puppies', label: 'Puppies', icon: '🐾' },
      { path: '/app/buyers',  label: 'Buyers',  icon: '👥' },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { path: '/app/reminders',  label: 'Reminders',  icon: '🔔', remindersItem: true },
      { path: '/app/documents',  label: 'Documents',  icon: '📄', documentsItem: true },
      { path: '/app/audit',      label: 'Activity',   icon: '📋' },
      { path: '/app/reports',    label: 'Insights',    icon: '📊' },
      { path: '/app/export',     label: 'Export',      icon: '📥' },
    ],
  },
  {
    label: 'ACCOUNT',
    items: [
      { path: '/app/settings', label: 'Settings', icon: '⚙️' },
    ],
  },
]

const BOTTOM_NAV_ITEMS = [
  { path: '/app/dashboard', icon: '⊞', label: 'Home' },
  { path: '/app/dogs',      icon: '🐕', label: 'Dogs' },
  { path: '/app/litters',   icon: '🐣', label: 'Litters', littersItem: true },
  { path: '/app/reminders', icon: '🔔', label: 'Reminders', remindersItem: true },
  { path: '/app/audit',     icon: '📋', label: 'Activity' },
]

export default function AppLayout({ toast }: Props) {
  const { user, profile, logout, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const isSuperAdmin = !!user?.email && SUPER_ADMIN_EMAILS.includes(user.email.trim().toLowerCase())

  const isOwner = profile?.role === 'owner'
  const hideLitters   = (profile as any)?.hideLitters   === true
  const hideDocuments = (profile as any)?.hideDocuments === true
  const hideReminders = (profile as any)?.hideReminders === true

  const [litterCount, setLitterCount] = useState<number | null>(null)
  const [dogCount,    setDogCount]    = useState<number>(0)
  const [pendingClaimCount, setPendingClaimCount] = useState<number>(0)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  // State backfill modal
  const [showStateModal,        setShowStateModal]        = useState(false)
  const [stateModalState,       setStateModalState]       = useState('NSW')
  const [stateModalBreederNum,  setStateModalBreederNum]  = useState('')
  const [savingStateModal,      setSavingStateModal]      = useState(false)

  useEffect(() => {
    if (!user) return
    getDogs()
      .then(dogs => setDogCount(dogs.filter((d: any) => d.status !== 'transferred' && d.transferStatus !== 'pendingClaim').length))
      .catch(() => setDogCount(0))
    if (user.email) {
      claimTransferredDogs(user.uid, user.email, 'check')
        .then(dogs => setPendingClaimCount(dogs.length))
        .catch(() => setPendingClaimCount(0))
    }
  }, [user])

  useEffect(() => {
    if (!isOwner) { setLitterCount(null); return }
    getLitters().then(l => setLitterCount(l.length)).catch(() => setLitterCount(0))
  }, [isOwner])

  useEffect(() => {
    if (profile && !profile.state) setShowStateModal(true)
  }, [profile])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [userMenuOpen])

  async function saveStateModal() {
    if (!user) return
    setSavingStateModal(true)
    try {
      await updateUserProfile(user.uid, {
        state: stateModalState as UserProfile['state'],
        ...(stateModalBreederNum.trim() && { breederIdValue: stateModalBreederNum.trim() }),
      })
      await refreshProfile()
      setShowStateModal(false)
      toast('Profile updated ✓', 'success')
    } catch {
      toast('Failed to save', 'error')
    } finally {
      setSavingStateModal(false)
    }
  }

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  const ownerHasLitters = isOwner && litterCount !== null && litterCount > 0

  function filterNavItems(items: NavItemDef[]) {
    return items.filter(item => {
      if (item.littersItem) {
        if (isOwner) return ownerHasLitters
        if (hideLitters) return false
      }
      if (item.documentsItem && hideDocuments) return false
      if (item.remindersItem && hideReminders) return false
      return true
    })
  }

  const planCfg = getPlanCfg(profile?.plan)
  const planLabel = profile?.plan === 'trial' ? 'Free Trial' : planCfg.label
  const dogLimit  = planCfg.dogLimit
  const dogPct    = dogLimit >= 9999 ? 100 : Math.min(100, Math.round((dogCount / dogLimit) * 100))
  const displayName = profile?.kennelName || profile?.firstName || 'User'
  const roleLabel   = profile?.role === 'breeder' ? 'Breeder' : 'Pet Owner'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--page-bg)' }}>

      {/* ── STATE BACKFILL MODAL ── */}
      {showStateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="card" style={{ width: '100%', maxWidth: 400, padding: '32px 28px' }}>
            <h2 style={{ fontSize: 20, fontFamily: 'var(--font-display)', marginBottom: 8, color: 'var(--dark)' }}>One quick update</h2>
            <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 24 }}>
              We&apos;ve added state-based breeding compliance. Please select your state to continue.
            </p>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label className="form-label">Your state <span style={{ color: 'var(--error)' }}>*</span></label>
              <select className="form-select" value={stateModalState} onChange={e => setStateModalState(e.target.value)}>
                {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 24 }}>
              <label className="form-label">Breeder registration number <span style={{ fontWeight: 400, color: 'var(--light)' }}>(optional)</span></label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. 12345678"
                value={stateModalBreederNum}
                onChange={e => setStateModalBreederNum(e.target.value)}
              />
              <span className="form-hint">e.g. Dogs SA membership no. or NSW BIN</span>
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', height: 44 }}
              onClick={saveStateModal}
              disabled={savingStateModal}
            >
              {savingStateModal ? <span className="spinner" /> : 'Save and continue'}
            </button>
          </div>
        </div>
      )}

      {/* ── SIDEBAR ── */}
      <aside style={{
        width: 'var(--sidebar-w)',
        background: 'var(--sidebar-bg)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 50,
      }}>

        {/* Logo + tagline */}
        <div style={{ padding: '20px 20px 16px', borderBottom: '1px solid var(--border)' }}>
          <img
            src="/logo.png"
            alt="iDogs"
            style={{ height: 44, width: 'auto', display: 'block', objectFit: 'contain', marginBottom: 6 }}
          />
          <p style={{ fontSize: 11, color: 'var(--brand-300)', fontWeight: 500, letterSpacing: '0.01em', margin: 0 }}>
            Every dog&apos;s story, forever.
          </p>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
          {NAV_SECTIONS.map((section, si) => {
            const visibleItems = filterNavItems(section.items)
            if (visibleItems.length === 0) return null
            return (
              <div key={si} style={{ marginBottom: 4 }}>
                <span style={{
                  display: 'block',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--light)',
                  letterSpacing: '0.08em',
                  padding: '10px 12px 4px',
                }}>
                  {section.label}
                </span>
                {visibleItems.map(item =>
                  item.comingSoon ? (
                    <div
                      key={item.path}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', borderRadius: 8, marginBottom: 1,
                        fontSize: 14, fontWeight: 400,
                        color: 'var(--light)',
                        cursor: 'default', userSelect: 'none',
                      }}
                    >
                      <span style={{ fontSize: 15, opacity: 0.6 }}>{item.icon}</span>
                      <span style={{ flex: 1 }}>{item.label}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        background: 'var(--sand)', color: 'var(--light)',
                        padding: '2px 7px', borderRadius: 20,
                        letterSpacing: '0.02em',
                      }}>Soon</span>
                    </div>
                  ) : (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      style={({ isActive }) => ({
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '9px 12px', borderRadius: 8, marginBottom: 1,
                        fontSize: 14, fontWeight: isActive ? 500 : 400,
                        color: isActive ? 'var(--brand-600)' : 'var(--mid)',
                        background: isActive ? 'var(--brand-50)' : 'transparent',
                        textDecoration: 'none', transition: 'background 0.12s, color 0.12s',
                      })}
                    >
                      <span style={{ fontSize: 15 }}>{item.icon}</span>
                      {item.label}
                    </NavLink>
                  )
                )}
              </div>
            )
          })}
        </nav>

        {/* Admin Console Shortcut */}
        {isSuperAdmin && (
          <div style={{ padding: '0 14px 12px' }}>
            <a
              href={`https://idogs-admin-codex.vercel.app/app/super-admin/dashboard?email=${encodeURIComponent(user?.email || '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                background: 'var(--gold-50, #FAF7EB)',
                color: 'var(--gold-500, #D4AF37)',
                border: '1px solid var(--gold-500, #D4AF37)',
                fontWeight: 600,
                textDecoration: 'none',
                boxSizing: 'border-box',
                height: 36,
                fontSize: 13,
                borderRadius: 8
              }}
            >
              👑 Admin Console ↗
            </a>
          </div>
        )}

        {/* Plan widget */}
        <div style={{ padding: '12px 14px 16px', borderTop: '1px solid var(--border)' }}>
          <div style={{
            background: 'var(--brand-50)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand-900)' }}>{planLabel}</span>
              {profile?.plan === 'kennel' && (
                <span style={{ fontSize: 10, fontWeight: 600, background: 'var(--gold-50)', color: 'var(--gold-500)', padding: '2px 7px', borderRadius: 20 }}>
                  👑 Kennel
                </span>
              )}
            </div>
            {dogLimit < 9999 ? (
              <>
                <div style={{ fontSize: 11, color: 'var(--mid)', marginBottom: 5 }}>
                  {dogCount} / {dogLimit} dogs
                </div>
                <div style={{ height: 4, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${dogPct}%`,
                    background: dogPct >= 90 ? 'var(--warning)' : 'var(--brand-600)',
                    borderRadius: 4,
                    transition: 'width 0.3s',
                  }} />
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--mid)' }}>
                {dogCount} dogs · Unlimited
              </div>
            )}
            {planCfg.upgrade && (
              <button
                className="btn btn-primary btn-sm"
                style={{ width: '100%', marginTop: 10, background: 'var(--gold-500)', borderColor: 'var(--gold-500)' }}
                onClick={() => navigate('/app/billing')}
              >
                Upgrade plan
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="main-area" style={{
        flex: 1,
        marginLeft: 'var(--sidebar-w)',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {pendingClaimCount > 0 && (
          <div style={{ background: 'var(--brand-600)', color: '#fff', padding: '12px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 45 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              🐾 You have {pendingClaimCount} dog{pendingClaimCount !== 1 ? 's' : ''} waiting to be claimed!
            </div>
            <Link to="/app/claim-dogs" className="btn btn-sm" style={{ background: '#fff', color: 'var(--brand-600)', border: 'none' }}>
              Review transfer
            </Link>
          </div>
        )}

        {/* Topbar (desktop) */}
        <header style={{
          height: 'var(--topbar-h)',
          background: 'var(--sidebar-bg)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }} className="desktop-topbar">
          {/* Left: greeting + date */}
          <div>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--brand-900)' }}>
              {getGreeting()}, {displayName}
            </span>
            <span style={{ fontSize: 13, color: 'var(--light)', marginLeft: 12 }}>
              {formatTodayLong()}
            </span>
          </div>

          {/* Right: bell + user menu */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Notification bell */}
            <button style={{
              width: 36, height: 36, border: 'none',
              background: 'transparent', borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'default', fontSize: 18, color: 'var(--light)',
            }} title="Notifications — coming soon">
              🔔
            </button>

            {/* User menu */}
            <div ref={userMenuRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setUserMenuOpen(o => !o)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '5px 10px 5px 6px',
                  background: 'transparent', border: '1px solid var(--border)',
                  borderRadius: 8, cursor: 'pointer',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--brand-50)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'var(--brand-50)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 600, color: 'var(--brand-600)',
                }}>
                  {getInitials(displayName)}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--dark)', lineHeight: 1.2 }}>
                    {displayName}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--light)', lineHeight: 1.2 }}>
                    {roleLabel}
                  </div>
                </div>
                <span style={{ fontSize: 10, color: 'var(--light)', marginLeft: 2 }}>▾</span>
              </button>

              {/* Dropdown */}
              {userMenuOpen && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  background: 'var(--white)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)',
                  minWidth: 160, zIndex: 100, overflow: 'hidden',
                }}>
                  {isSuperAdmin && (
                    <>
                      <a
                        href={`https://idogs-admin-codex.vercel.app/app/super-admin/dashboard?email=${encodeURIComponent(user?.email || '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          width: '100%', padding: '10px 14px',
                          background: 'none', border: 'none',
                          fontSize: 13, color: 'var(--gold-500, #D4AF37)', cursor: 'pointer',
                          textAlign: 'left', textDecoration: 'none', boxSizing: 'border-box'
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--gold-50, #FAF7EB)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >
                        👑 Admin Console ↗
                      </a>
                      <div style={{ height: 1, background: 'var(--border)' }} />
                    </>
                  )}
                  <button
                    onClick={() => { setUserMenuOpen(false); navigate('/app/settings') }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '10px 14px',
                      background: 'none', border: 'none',
                      fontSize: 13, color: 'var(--dark)', cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--brand-50)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    ⚙️ Settings
                  </button>
                  <div style={{ height: 1, background: 'var(--border)' }} />
                  <button
                    onClick={() => { setUserMenuOpen(false); handleLogout() }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      width: '100%', padding: '10px 14px',
                      background: 'none', border: 'none',
                      fontSize: 13, color: 'var(--danger)', cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#FEF2F2')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    ⏻ Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile top bar */}
        <div style={{
          display: 'none',
          padding: '12px 16px',
          background: 'var(--white)',
          borderBottom: '1px solid var(--border)',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 40,
        }} className="mobile-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src="/logo.png" alt="iDogs" style={{ height: 28, width: 96, objectFit: 'contain' }} />
          </div>
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--mid)', cursor: 'pointer' }}>
            Sign out
          </button>
        </div>

        {/* Page content */}
        <main style={{ flex: 1 }}>
          <Outlet />
        </main>
      </div>

      {/* ── BOTTOM NAV (mobile only) ── */}
      <nav className="bottom-nav">
        {BOTTOM_NAV_ITEMS.filter(item => {
          if (item.littersItem) {
            if (isOwner) return ownerHasLitters
            if (hideLitters) return false
          }
          if ((item as any).remindersItem && hideReminders) return false
          return true
        }).map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}
          >
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
        <button
          onClick={handleLogout}
          className="bottom-nav-item"
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <span>↩</span>
          <span>Sign out</span>
        </button>
      </nav>
    </div>
  )
}
