import React, { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { getLitters, updateUserProfile } from '../../lib/db'
import { getInitials, AU_STATES } from '../../lib/utils'
import type { ToastMessage, UserProfile } from '../../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

const BASE_NAV_ITEMS = [
  { path: '/app/dashboard', icon: '◈', label: 'Dashboard' },
  { path: '/app/dogs', icon: '🐕', label: 'My dogs' },
  { path: '/app/litters', icon: '🐣', label: 'Litters', littersItem: true },
  { path: '/app/reminders', icon: '🔔', label: 'Reminders', remindersItem: true },
  { path: '/app/documents', icon: '📄', label: 'Documents', documentsItem: true },
  { path: '/app/export', icon: '📊', label: 'Export' },
  { path: '/app/audit', icon: '📋', label: 'Activity' },
  { path: '/app/billing', icon: '💳', label: 'Billing' },
  { path: '/app/settings', icon: '⚙️', label: 'Settings' },
]

const BASE_BOTTOM_NAV = [
  { path: '/app/dashboard', icon: '◈', label: 'Home' },
  { path: '/app/dogs', icon: '🐕', label: 'Dogs' },
  { path: '/app/litters', icon: '🐣', label: 'Litters', littersItem: true },
  { path: '/app/reminders', icon: '🔔', label: 'Reminders', remindersItem: true },
  { path: '/app/export', icon: '📊', label: 'Export' },
  { path: '/app/audit', icon: '📋', label: 'Activity' },
]

export default function AppLayout({ toast }: Props) {
  const { user, profile, logout, refreshProfile } = useAuth()
  const navigate = useNavigate()

  const isOwner = profile?.role === 'owner'
  const hideLitters = (profile as any)?.hideLitters === true
  const [litterCount, setLitterCount] = useState<number | null>(null)

  // Backfill modal for existing users missing state
  const [showStateModal, setShowStateModal] = useState(false)
  const [stateModalState, setStateModalState] = useState('NSW')
  const [stateModalBreederNumber, setStateModalBreederNumber] = useState('')
  const [savingStateModal, setSavingStateModal] = useState(false)

  useEffect(() => {
    if (!isOwner) { setLitterCount(null); return }
    getLitters().then(l => setLitterCount(l.length)).catch(() => setLitterCount(0))
  }, [isOwner])

  useEffect(() => {
    if (profile && !profile.state) setShowStateModal(true)
  }, [profile])

  async function saveStateModal() {
    if (!user) return
    setSavingStateModal(true)
    try {
      await updateUserProfile(user.uid, {
        state: stateModalState as UserProfile['state'],
        ...(stateModalBreederNumber.trim() && { breederIdValue: stateModalBreederNumber.trim() }),
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

  // Owner: show litters tab only if they have past litters
  const ownerHasLitters = isOwner && litterCount !== null && litterCount > 0
  const hideDocuments = (profile as any)?.hideDocuments === true
  const hideReminders = (profile as any)?.hideReminders === true

  const NAV_ITEMS = BASE_NAV_ITEMS.filter(item => {
    if ((item as any).littersItem) {
      if (isOwner) return ownerHasLitters  // owner: only show if has past litters
      if (hideLitters) return false         // breeder: respect toggle
    }
    if ((item as any).documentsItem && hideDocuments) return false
    if ((item as any).remindersItem && hideReminders) return false
    return true
  })
  const BOTTOM_NAV = BASE_BOTTOM_NAV.filter(item => {
    if ((item as any).littersItem) {
      if (isOwner) return ownerHasLitters
      if (hideLitters) return false
    }
    if ((item as any).remindersItem && hideReminders) return false
    return true
  })

  async function handleLogout() {
    await logout()
    navigate('/')
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--sand)' }}>

      {/* ── STATE BACKFILL MODAL ── */}
      {showStateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="card" style={{ width: '100%', maxWidth: 400, padding: '32px 28px' }}>
            <h2 style={{ fontSize: 20, fontFamily: 'var(--font-display)', marginBottom: 8, color: 'var(--dark)' }}>One quick update</h2>
            <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 24 }}>
              We've added state-based breeding compliance. Please select your state to continue.
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
                value={stateModalBreederNumber}
                onChange={e => setStateModalBreederNumber(e.target.value)}
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

      {/* ── SIDEBAR (desktop only) ── */}
      <aside style={{
        width: 220,
        background: 'var(--white)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, left: 0, bottom: 0,
        zIndex: 50,
      }}>
        {/* Logo */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <img
            src="/logo.png"
            alt="iDogs"
            style={{ height: 50, width: 'auto', display: 'block', objectFit: 'contain' }}
          />
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
          {NAV_ITEMS.map(item => (
            <NavLink key={item.path} to={item.path} style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 8, marginBottom: 2,
              fontSize: 14, fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--green)' : 'var(--mid)',
              background: isActive ? 'var(--green-light)' : 'transparent',
              textDecoration: 'none', transition: 'background 0.12s, color 0.12s',
            })}>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Sign out button */}
        <div style={{ padding: '8px 10px' }}>
          <button
            onClick={handleLogout}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 8,
              fontSize: 14, fontWeight: 400,
              color: 'var(--mid)', background: 'transparent',
              border: 'none', cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
              textAlign: 'left',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.color = 'var(--error)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--mid)' }}
          >
            <span style={{ fontSize: 16 }}>⏻</span>
            Sign out
          </button>
        </div>

        {/* User */}
        <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)' }}>
          {profile?.plan === 'trial' && (
            <div style={{
              padding: '6px 10px', borderRadius: 8,
              background: 'var(--gold-light)', border: '1px solid rgba(200,151,31,0.2)',
              marginBottom: 10, fontSize: 12, color: 'var(--gold)', fontWeight: 500,
            }}>🎉 30-day free trial</div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'var(--green-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 600, color: 'var(--green)', flexShrink: 0,
            }}>
              {getInitials(profile?.kennelName || profile?.firstName || 'U')}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--dark)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.kennelName || profile?.firstName}
              </div>
              <div style={{ fontSize: 11, color: 'var(--light)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {profile?.email}
              </div>
            </div>
            <button onClick={handleLogout} title="Sign out" style={{
              width: 28, height: 28, border: 'none', background: 'transparent',
              color: 'var(--light)', borderRadius: 6, cursor: 'pointer', fontSize: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'color 0.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--light)')}
            >⏻</button>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main style={{
        flex: 1,
        marginLeft: 220,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
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
          <button onClick={handleLogout} style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--mid)', cursor: 'pointer' }}>Sign out</button>
        </div>

        <Outlet />
      </main>

      {/* ── BOTTOM NAV (mobile only) ── */}
      <nav className="bottom-nav">
        {BOTTOM_NAV.map(item => (
          <NavLink key={item.path} to={item.path} className={({ isActive }) => `bottom-nav-item${isActive ? ' active' : ''}`}>
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
