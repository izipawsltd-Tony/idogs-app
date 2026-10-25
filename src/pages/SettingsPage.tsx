import { DATA_PROCESSING_SUMMARY } from '../components/legal/PolicyReview'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { doc, getDocFromServer } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../hooks/useAuth'
import { updateUserProfile } from '../lib/db'
import { BREEDER_ID_CONFIG, suggestBreederIdType, getEffectivePlanClient, hasValidInternalEntitlementClient } from '../lib/utils'
import { isNativeApp } from '../lib/nativePlatform'
import AccountDeletion from '../components/ui/AccountDeletion'
import { REMINDER_TYPES } from '../components/ui/ReminderForm'
import type { Reminder, ToastMessage } from '../types'

interface Props {
  toast: (msg: string, type?: ToastMessage['type']) => void
}

const REMINDER_OPTIONS = [3, 7, 14, 30]

export default function SettingsPage({ toast }: Props) {
  const { user, profile, refreshProfile } = useAuth()
  const [showReminderTypes, setShowReminderTypes] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState({
    firstName: profile?.firstName || '',
    lastName: profile?.lastName || '',
    kennelName: profile?.kennelName || '',
    phone: (profile as any)?.phone || '',
    state: profile?.state || 'SA',
    breederIdType: profile?.breederIdType || 'NONE',
    breederIdValue: profile?.breederIdValue || '',
  })
  const [savingProfile, setSavingProfile] = useState(false)
  const [changingRole, setChangingRole] = useState(false)

  const marketingEnabled = Boolean(user?.email && profile?.marketingConsent?.channel === 'email_marketing' && profile.marketingConsent.choice === 'opt_in' && !profile.marketingConsent.revokedAt && profile.marketingConsent.email?.toLowerCase() === user.email.toLowerCase())
  const isOwner = profile?.role === 'owner'
  const effectivePlan = getEffectivePlanClient(profile)
  const includedAccess = hasValidInternalEntitlementClient(profile?.internalEntitlement, new Date())
  const nativeApp = isNativeApp()
  const hideLitters = (profile as any)?.hideLitters === true
  const hideDocuments = (profile as any)?.hideDocuments === true
  const hideReminders = (profile as any)?.hideReminders === true
  const emailReminders = (profile as any)?.emailReminders !== false // default true
  const reminderDays = (profile as any)?.reminderDays || 7
  const reminderFrequency = (profile as any)?.reminderFrequency || 'once'
  const heatReminderDays = (profile as any)?.heatReminderDays || 14

  async function toggle(field: string, current: boolean, onMsg: string, offMsg: string) {
    if (!user) return
    setSaving(field)
    try {
      await updateUserProfile(user.uid, { [field]: !current } as any)
      await refreshProfile()
      toast(!current ? offMsg : onMsg)
    } catch {
      toast('Failed to save setting', 'error')
    } finally {
      setSaving(null)
    }
  }

  async function setMarketingConsent(enabled: boolean) {
    if (!user || saving) return
    setSaving('marketingConsent')
    try {
      const existing = profile?.marketingConsent
      const now = new Date().toISOString()
      await updateUserProfile(user.uid, {
        marketingConsent: {
          channel: 'email_marketing',
          choice: enabled ? 'opt_in' : 'opt_out',
          source: 'account_settings',
          checkboxDefault: false,
          policyVersion: 'marketing-v1-2026-10',
          optedInAt: enabled ? now : existing?.optedInAt || null,
          revokedAt: enabled ? null : now,
          email: user.email || '',
          evidenceRef: enabled ? 'settings-opt-in-v1' : 'settings-opt-out-v1',
        },
      })
      // Do not trust a local-cache echo as evidence of remote persistence.
      // Read back from Firestore server before reporting success.
      const stored = await getDocFromServer(doc(db, 'users', user.uid))
      const actual = stored.data()?.marketingConsent
      if (!stored.exists() || actual?.choice !== (enabled ? 'opt_in' : 'opt_out') ||
          actual?.source !== 'account_settings' || actual?.channel !== 'email_marketing' ||
          actual?.email?.toLowerCase() !== user.email?.toLowerCase() ||
          actual?.evidenceRef !== (enabled ? 'settings-opt-in-v1' : 'settings-opt-out-v1') ||
          (enabled ? actual?.revokedAt != null : !actual?.revokedAt)) {
        throw new Error('MARKETING_CONSENT_NOT_PERSISTED')
      }
      await refreshProfile(true)
      toast(enabled ? 'Marketing email preference saved' : 'Marketing emails disabled', 'success')
    } catch {
      toast('Could not save marketing preference. Please try again.', 'error')
    } finally { setSaving(null) }
  }

  async function setEmailSetting(field: 'emailReminders' | 'manualReminderEmails', enabled: boolean) {
    if (!user || saving) return
    setSaving(field)
    try {
      await updateUserProfile(user.uid, { [field]: enabled })
      await refreshProfile()
      toast(enabled ? 'Email reminders enabled' : 'Email reminders disabled')
    } catch { toast('Failed to save setting', 'error') }
    finally { setSaving(null) }
  }

  async function setCareEmailType(type: Reminder['type'], enabled: boolean) {
    if (!user || saving) return
    setSaving(`careEmailTypes.${type}`)
    try {
      // Merge one nested key so concurrent edits to another category survive.
      await updateUserProfile(user.uid, { careEmailTypes: { [type]: enabled } })
      await refreshProfile()
      toast('Email preference saved')
    } catch { toast('Failed to save setting', 'error') }
    finally { setSaving(null) }
  }

  async function setReminderDays(days: number) {
    if (!user) return
    setSaving('reminderDays')
    try {
      await updateUserProfile(user.uid, { reminderDays: days } as any)
      await refreshProfile()
      toast(`Reminder lead time set to ${days} days`)
    } catch {
      toast('Failed to save setting', 'error')
    } finally {
      setSaving(null)
    }
  }

  async function setReminderFrequency(freq: 'once' | 'daily') {
    if (!user) return
    setSaving('reminderFrequency')
    try {
      await updateUserProfile(user.uid, { reminderFrequency: freq } as any)
      await refreshProfile()
      toast(freq === 'once' ? 'You\'ll get one reminder per due date' : 'You\'ll get a daily reminder until the due date')
    } catch {
      toast('Failed to save setting', 'error')
    } finally {
      setSaving(null)
    }
  }

  async function setHeatReminderDays(days: number) {
    if (!user) return
    setSaving('heatReminderDays')
    try {
      await updateUserProfile(user.uid, { heatReminderDays: days } as any)
      await refreshProfile()
      toast(`Heat cycle reminder set to ${days} days before`)
    } catch {
      toast('Failed to save setting', 'error')
    } finally {
      setSaving(null)
    }
  }

  async function saveProfile() {
    if (!user) return
    setSavingProfile(true)
    try {
      await updateUserProfile(user.uid, {
        firstName: profileForm.firstName.trim(),
        lastName: profileForm.lastName.trim(),
        kennelName: profileForm.kennelName.trim(),
        phone: profileForm.phone.trim(),
        state: profileForm.state as any,
        ...(!isOwner && {
          breederIdType: profileForm.breederIdType as any,
          breederIdValue: profileForm.breederIdType === 'NONE' ? '' : profileForm.breederIdValue.trim(),
        }),
      })
      await refreshProfile()
      setEditingProfile(false)
      toast('Profile updated ✓', 'success')
    } catch {
      toast('Failed to save profile', 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  async function changeRole(newRole: 'breeder' | 'owner') {
    if (!user) return
    setChangingRole(true)
    try {
      await updateUserProfile(user.uid, { role: newRole } as any)
      await refreshProfile()
      toast(`Account type changed to ${newRole === 'breeder' ? 'Breeder' : 'Pet Owner'} ✓`, 'success')
    } catch {
      toast('Failed to change account type', 'error')
    } finally {
      setChangingRole(false)
    }
  }

  const AU_STATES = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--dark)', marginBottom: 4 }}>Settings</h1>
      <p style={{ fontSize: 14, color: 'var(--light)', marginBottom: 32 }}>Manage your account preferences.</p>

      <section className="card" aria-labelledby="current-plan-heading" style={{ marginBottom: 16 }}>
        <h2 id="current-plan-heading" style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px', color: 'var(--dark)' }}>Current plan</h2>
        {profile ? (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)', marginBottom: 8 }}>
              {effectivePlan === 'plus' ? 'Plus' : 'Free'}{includedAccess ? ' · Included access' : ''}
            </div>
            <p style={{ fontSize: 13, color: 'var(--mid)', margin: '0 0 8px' }}>
              {includedAccess ? 'Unlimited dogs' : effectivePlan === 'plus' ? 'Up to 5 dogs' : 'Up to 2 dogs'} · Health records, reminders, documents and QR Passport
            </p>
            <p style={{ fontSize: 13, color: 'var(--mid)', margin: '0 0 12px' }}>
              {effectivePlan === 'plus' ? '10 AI document scans per month' : '2 AI document scans for the life of your account'}. Dogs over your plan limit stay saved and become read-only.
            </p>
          </>
        ) : (
          <p role="status" style={{ fontSize: 13, color: 'var(--mid)' }}>Your plan is temporarily unavailable. Please try again after reconnecting.</p>
        )}
        {nativeApp && <p style={{ fontSize: 13, color: 'var(--mid)', margin: '0 0 12px' }}>Purchases are unavailable in this app. Your existing plan access remains available.</p>}
        <Link to="/app/billing" className="btn btn-secondary" style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center', textDecoration: 'none' }}>View plan details</Link>
      </section>

      {/* ── PROFILE ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Profile</div>
          {!editingProfile && (
            <button className="btn btn-secondary btn-sm" onClick={() => {
              setProfileForm({
                firstName: profile?.firstName || '',
                lastName: profile?.lastName || '',
                kennelName: profile?.kennelName || '',
                phone: (profile as any)?.phone || '',
                state: profile?.state || 'SA',
                breederIdType: profile?.breederIdType || 'NONE',
                breederIdValue: profile?.breederIdValue || '',
              })
              setEditingProfile(true)
            }}>✏️ Edit</button>
          )}
        </div>

        {editingProfile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">First name</label>
                <input className="form-input" value={profileForm.firstName} onChange={e => setProfileForm(p => ({ ...p, firstName: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Last name</label>
                <input className="form-input" value={profileForm.lastName} onChange={e => setProfileForm(p => ({ ...p, lastName: e.target.value }))} />
              </div>
            </div>
            {!isOwner && (
              <div className="form-group">
                <label className="form-label">Kennel name</label>
                <input className="form-input" value={profileForm.kennelName} onChange={e => setProfileForm(p => ({ ...p, kennelName: e.target.value }))} />
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
              <div className="form-group">
                <label className="form-label">Phone</label>
                <input className="form-input" placeholder="04XX XXX XXX" value={profileForm.phone} onChange={e => setProfileForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">State</label>
                <select
                  className="form-select"
                  style={{ width: 90 }}
                  value={profileForm.state}
                  onChange={e => {
                    const newState = e.target.value
                    setProfileForm(p => ({
                      ...p,
                      state: newState as any,
                      // Only re-suggest if breeder hasn't touched the
                      // Breeder ID field yet — never overwrite a value
                      // they've already started filling in.
                      breederIdType: (p.breederIdType === 'NONE' && !p.breederIdValue)
                        ? suggestBreederIdType(newState)
                        : p.breederIdType,
                    }))
                  }}
                >
                  {AU_STATES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {!isOwner && (
              <div style={{ display: 'grid', gridTemplateColumns: profileForm.breederIdType !== 'NONE' ? '1fr 1fr' : '1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">Breeder ID type</label>
                  <select
                    className="form-select"
                    value={profileForm.breederIdType}
                    onChange={e => setProfileForm(p => ({ ...p, breederIdType: e.target.value as any }))}
                  >
                    {(Object.keys(BREEDER_ID_CONFIG) as Array<keyof typeof BREEDER_ID_CONFIG>).map(key => (
                      <option key={key} value={key}>{BREEDER_ID_CONFIG[key].label}</option>
                    ))}
                  </select>
                  <span className="form-hint">e.g. DACO number for SA breeders. Leave as "No official ID yet" if your dogs aren't old enough to breed from yet.</span>
                </div>
                {profileForm.breederIdType !== 'NONE' && (
                  <div className="form-group">
                    <label className="form-label">Breeder ID value</label>
                    <input className="form-input" placeholder="e.g. B123456789" value={profileForm.breederIdValue} onChange={e => setProfileForm(p => ({ ...p, breederIdValue: e.target.value }))} />
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn btn-primary btn-sm" onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? <span className="spinner" style={{ width: 14, height: 14, borderTopColor: '#fff' }} /> : 'Save changes'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setEditingProfile(false)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <SettingRow label="Name" value={`${profile?.firstName || ''} ${profile?.lastName || ''}`.trim() || '—'} />
            <SettingRow label="Email" value={profile?.email || user?.email || '—'} />
            {/* Account type with change button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, paddingBottom: 12, borderBottom: '1px solid var(--sand)' }}>
              <span style={{ color: 'var(--light)' }}>Account type</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ color: 'var(--dark)', fontWeight: 500 }}>{isOwner ? '🐾 Pet Owner' : '🏆 Breeder'}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => changeRole(isOwner ? 'breeder' : 'owner')}
                  disabled={changingRole}
                  style={{ fontSize: 11, padding: '3px 10px' }}
                >
                  {changingRole
                    ? <span className="spinner" style={{ width: 12, height: 12 }} />
                    : `Switch to ${isOwner ? 'Breeder' : 'Pet Owner'}`}
                </button>
              </div>
            </div>
            {!isOwner && <SettingRow label="Kennel name" value={profile?.kennelName || '—'} />}
            <SettingRow label="Phone" value={(profile as any)?.phone || '—'} />
            <SettingRow label="State" value={profile?.state || '—'} />
            {!isOwner && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, paddingBottom: 12, borderBottom: '1px solid var(--sand)' }}>
                <span style={{ color: 'var(--light)' }}>
                  {profile?.breederIdType && profile.breederIdType !== 'NONE' ? BREEDER_ID_CONFIG[profile.breederIdType].label : 'Breeder ID'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--dark)', fontWeight: 500 }}>{profile?.breederIdValue || '—'}</span>
                  {profile?.breederIdType && profile.breederIdType !== 'NONE' && BREEDER_ID_CONFIG[profile.breederIdType].verifyUrl && (
                    <a
                      href={BREEDER_ID_CONFIG[profile.breederIdType].verifyUrl!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--green)', fontWeight: 500, textDecoration: 'none', fontSize: 12 }}
                    >
                      Verify ↗
                    </a>
                  )}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── NAVIGATION ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Navigation</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Litters — breeder-only; Litter Management is a breeding
              feature and has no relevance to a Pet Owner account, so it's
              not rendered at all for isOwner (not merely disabled). */}
          {!isOwner && (
            <ToggleRow
              icon="🐣" label="Litters"
              description="Show Litters in the navigation menu."
              enabled={!hideLitters}
              saving={saving === 'hideLitters'}
              onToggle={() => toggle('hideLitters', hideLitters, 'Litters shown in nav', 'Litters hidden from nav')}
            />
          )}

          {/* Documents */}
          <ToggleRow
            icon="📄" label="Documents"
            description="Show Documents in the navigation menu."
            enabled={!hideDocuments}
            saving={saving === 'hideDocuments'}
            onToggle={() => toggle('hideDocuments', hideDocuments, 'Documents shown in nav', 'Documents hidden from nav')}
          />

          {/* Reminders */}
          <ToggleRow
            icon="🔔" label="Reminders"
            description="Show Reminders in the navigation menu."
            enabled={!hideReminders}
            saving={saving === 'hideReminders'}
            onToggle={() => toggle('hideReminders', hideReminders, 'Reminders shown in nav', 'Reminders hidden from nav')}
          />
        </div>
      </div>

      {/* ── NOTIFICATIONS ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notifications</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Email reminders toggle */}
          <ToggleRow
            icon="✉️" label="Email Reminders"
            description="Receive scheduled emails. Turning this off does not disable SMS or in-app reminders."
            enabled={emailReminders}
            saving={saving !== null}
            onToggle={() => setEmailSetting('emailReminders', !emailReminders)}
          />

          <ToggleRow
            icon="📋" label="Manual reminder emails"
            description="Email reminders you add yourself. Off by default. Uses each reminder’s lead time; checked once daily, not at a chosen hour."
            enabled={profile?.manualReminderEmails === true}
            saving={saving !== null || !emailReminders}
            onToggle={() => setEmailSetting('manualReminderEmails', profile?.manualReminderEmails !== true)}
          />
          <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <button type="button" aria-expanded={showReminderTypes} aria-controls="manual-reminder-types" onClick={() => setShowReminderTypes(value => !value)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, width: '100%', padding: '8px 0', border: 0, background: 'transparent', color: 'var(--dark)', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Manual reminder email types</span>
              <span style={{ fontSize: 13, color: 'var(--green)', whiteSpace: 'nowrap' }}>{showReminderTypes ? 'Hide ▴' : 'Show ▾'}</span>
            </button>
            {showReminderTypes && <div id="manual-reminder-types" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {REMINDER_TYPES.map(({ value, label }) => <ToggleRow key={value}
                icon="" label={label}
                description="Emails for manually added reminders."
                enabled={profile?.careEmailTypes?.[value] !== false}
                saving={saving !== null || !emailReminders}
                onToggle={() => setCareEmailType(value, profile?.careEmailTypes?.[value] === false)}
              />)}
            </div>}
            {showReminderTypes && <p style={{ fontSize: 12, color: 'var(--mid)', marginTop: 12 }}>These type choices apply to manually added reminder emails. Recorded next-dose reminders use the main Email Reminders setting. In-app reminders stay visible. iPhone push notifications are not enabled by these settings. Once-only manual emails can catch up up to 14 days after the due date; daily manual emails stop after it.</p>}
          </div>

          {/* Reminder lead time */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)', marginBottom: 6 }}>⏰ Reminder lead time</div>
              <div style={{ fontSize: 13, color: 'var(--light)', marginBottom: 10 }}>Default lead time for recorded health reminders. Manual reminders use their own lead time.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {REMINDER_OPTIONS.map(days => (
                  <button
                    key={days}
                    onClick={() => setReminderDays(days)}
                    disabled={saving === 'reminderDays'}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
                      border: `1.5px solid ${reminderDays === days ? 'var(--green)' : 'var(--border)'}`,
                      background: reminderDays === days ? 'var(--green-light)' : 'var(--white)',
                      color: reminderDays === days ? 'var(--green)' : 'var(--mid)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {days}d
                  </button>
                ))}
              </div>
            </div>

          {/* Reminder frequency */}
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)', marginBottom: 6 }}>🔁 Reminder frequency</div>
              <div style={{ fontSize: 13, color: 'var(--light)', marginBottom: 10 }}>How often to email you once a due date is approaching. SMS is sent once per due date, subject to your add-on and credits.</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {([
                  { id: 'once', label: 'Once' },
                  { id: 'daily', label: 'Daily until due' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setReminderFrequency(opt.id)}
                    disabled={saving === 'reminderFrequency'}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
                      border: `1.5px solid ${reminderFrequency === opt.id ? 'var(--green)' : 'var(--border)'}`,
                      background: reminderFrequency === opt.id ? 'var(--green-light)' : 'var(--white)',
                      color: reminderFrequency === opt.id ? 'var(--green)' : 'var(--mid)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

          {/* Heat cycle reminder lead time — breeding-specific, not
              relevant to a Pet Owner account (see Litters above). */}
          {!isOwner && (
            <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)', marginBottom: 4 }}>🌸 Heat cycle reminder lead time</div>
              <div style={{ fontSize: 13, color: 'var(--light)', marginBottom: 10 }}>
                How many days before a predicted heat cycle to send a reminder. Set higher than vaccine reminders so you have time to prepare.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[7, 14, 21, 30].map(days => (
                  <button
                    key={days}
                    onClick={() => setHeatReminderDays(days)}
                    disabled={saving === 'heatReminderDays'}
                    style={{
                      padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
                      border: `1.5px solid ${heatReminderDays === days ? 'var(--green)' : 'var(--border)'}`,
                      background: heatReminderDays === days ? 'var(--green-light)' : 'var(--white)',
                      color: heatReminderDays === days ? 'var(--green)' : 'var(--mid)',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {days}d
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--light)' }}>
                Currently: <strong>{heatReminderDays} days</strong> before predicted heat · Default is 14 days
              </div>
            </div>
          )}
          <div style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)', marginBottom: 4 }}>SMS Reminders</div>
            <div style={{ fontSize: 13, color: 'var(--light)', lineHeight: 1.55 }}>
              Paid SMS reminders cover vaccination, worming and the breeding cycle:
              heat, mating, pregnancy and whelping. Your account mobile number is
              <strong> {profile?.phone || 'not set'}</strong>.
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--mid)' }}>
              Status: <strong style={{ textTransform: 'capitalize' }}>{profile?.smsAddonStatus || 'inactive'}</strong>
              {' · '}20 credits/month. A long or Unicode SMS can use more than one credit.
            </div>
            <a className="btn btn-secondary btn-sm" href="/app/billing" style={{ marginTop: 10, display: 'inline-flex' }}>
              {profile?.smsAddonStatus === 'active' ? 'Manage SMS add-on' : 'View SMS add-on'}
            </a>
          </div>
        </div>
      </div>

      {/* Marketing emails are separate from transactional and care reminders. */}
      <div className="card" style={{ marginBottom: 16, padding: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', textTransform: 'uppercase', marginBottom: 14 }}>Marketing emails</div>
        <ToggleRow
          icon="✉️"
          label="iDogs news and promotional offers"
          description="Optional product news and offers. You can turn this off at any time. Dog-care and account emails are separate."
          enabled={Boolean(marketingEnabled)}
          saving={saving === 'marketingConsent'}
          onToggle={() => setMarketingConsent(!marketingEnabled)}
        />
        <p style={{ fontSize: 12, color: 'var(--light)', marginTop: 10 }}>Existing accounts are off unless they explicitly opt in.</p>
       </div>

      {/* ── DATA & PRIVACY ── */}
      <AccountDeletion />
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--mid)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data & Privacy</div>
        <div style={{ fontSize: 13, color: 'var(--green)', background: 'var(--green-light)', padding: '10px 14px', borderRadius: 8, marginBottom: 12 }}>
          🔒 {DATA_PROCESSING_SUMMARY}
        </div>
        <div style={{ fontSize: 13, color: 'var(--mid)', lineHeight: 1.6 }}>
          Your dog profiles, health records, and documents are private by default. Public passport pages only show information you choose to share via QR code.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
          <Link to="/privacy" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Privacy policy</Link>
          <Link to="/terms" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Terms of use</Link>
        </div>
      </div>
    </div>
  )
}

// ── REUSABLE COMPONENTS ───────────────────────────────────────

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, paddingBottom: 12, borderBottom: '1px solid var(--sand)' }}>
      <span style={{ color: 'var(--light)' }}>{label}</span>
      <span style={{ color: 'var(--dark)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function ToggleRow({ icon, label, description, enabled, saving, onToggle }: {
  icon: string
  label: string
  description: string
  enabled: boolean
  saving: boolean
  onToggle: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--dark)', marginBottom: 2 }}>{icon} {label}</div>
        <div style={{ fontSize: 13, color: 'var(--light)' }}>{description}</div>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={saving}
        style={{
          width: 48, height: 26, borderRadius: 13, flexShrink: 0,
          background: enabled ? 'var(--green)' : 'var(--border)',
          border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
          position: 'relative', transition: 'background 0.2s',
          opacity: saving ? 0.6 : 1,
        }}
      >
        <span style={{
          position: 'absolute', top: 3,
          left: enabled ? 22 : 4,
          width: 20, height: 20,
          background: '#fff', borderRadius: '50%',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  )
}
