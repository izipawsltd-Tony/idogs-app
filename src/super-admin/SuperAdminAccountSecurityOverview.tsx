import type { EmailVerificationStatus } from './SuperAdminEmailVerificationAction'
import type { PasswordResetStatus } from './SuperAdminPasswordResetAction'

export type AccountSecurityStatus = 'normal' | 'attention_required' | 'access_restricted' | 'auth_unavailable'

export interface AccountSecurityOverview {
  status: AccountSecurityStatus
  reasons: string[]
  authRecord: 'available' | 'unavailable'
  emailVerification: 'verified' | 'unverified' | 'unavailable'
  signInProviders: string[]
  passwordSignIn: 'available' | 'unsupported'
  accountCreatedAt: string | null
  lastSignInAt: string | null
  lastRefreshAt: string | null
  firebaseDisabled: boolean | null
  platformAccess: 'active' | 'suspended' | 'unavailable'
  internalEntitlement: { status: 'active' | 'expired' | 'revoked' | 'not_configured'; expiresAt: string | null }
}

interface Props {
  overview: AccountSecurityOverview
  emailVerificationStatus: EmailVerificationStatus
  passwordResetStatus: PasswordResetStatus
}

const statusLabels: Record<AccountSecurityStatus, string> = {
  normal: 'Normal',
  attention_required: 'Attention required',
  access_restricted: 'Access restricted',
  auth_unavailable: 'Auth unavailable',
}

function formatDateTime(value: string | null) {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Australia/Adelaide' })
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase())
}

export default function SuperAdminAccountSecurityOverview({ overview, emailVerificationStatus, passwordResetStatus }: Props) {
  const entitlement = overview.internalEntitlement
  return (
    <section className="super-admin-panel super-admin-security-overview" aria-labelledby="account-security-heading">
      <div className="super-admin-panel-header">
        <div>
          <h3 id="account-security-heading">Account Security</h3>
          <p>Read-only Firebase Auth and platform access signals. This is not a risk score.</p>
        </div>
        <span className={`super-admin-security-status security-${overview.status}`} role="status">
          Status: {statusLabels[overview.status]}
        </span>
      </div>

      {overview.reasons.length > 0 && (
        <div className="super-admin-security-reasons" aria-label="Security status reasons">
          <strong>Reason{overview.reasons.length > 1 ? 's' : ''}</strong>
          <ul>{overview.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}

      <dl className="super-admin-security-grid">
        <div><dt>Firebase Auth record</dt><dd>{humanize(overview.authRecord)}</dd></div>
        <div><dt>Email</dt><dd>{humanize(overview.emailVerification)}</dd></div>
        <div><dt>Sign-in providers</dt><dd>{overview.signInProviders.length ? overview.signInProviders.join(', ') : 'Unavailable'}</dd></div>
        <div><dt>Password sign-in</dt><dd>{humanize(overview.passwordSignIn)}</dd></div>
        <div><dt>Account created</dt><dd>{formatDateTime(overview.accountCreatedAt)}</dd></div>
        <div><dt>Last sign-in</dt><dd>{formatDateTime(overview.lastSignInAt)}</dd></div>
        <div><dt>Last Auth refresh</dt><dd>{formatDateTime(overview.lastRefreshAt)}</dd></div>
        <div><dt>Firebase disabled</dt><dd>{overview.firebaseDisabled === null ? 'Unavailable' : overview.firebaseDisabled ? 'Yes' : 'No'}</dd></div>
        <div><dt>Platform access</dt><dd>{humanize(overview.platformAccess)}</dd></div>
        <div><dt>Internal entitlement</dt><dd>{humanize(entitlement.status)}{entitlement.expiresAt ? ` · expires ${formatDateTime(entitlement.expiresAt)}` : ''}</dd></div>
      </dl>

      {(emailVerificationStatus === 'not_verified' || passwordResetStatus === 'available') && (
        <nav className="super-admin-security-actions" aria-label="Available account support actions">
          <span>Available support:</span>
          {emailVerificationStatus === 'not_verified' && <a href="#email-verification-support">Resend verification email</a>}
          {passwordResetStatus === 'available' && <a href="#password-reset-support">Send password reset email</a>}
        </nav>
      )}
    </section>
  )
}
