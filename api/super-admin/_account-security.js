import { supportsPasswordSignIn } from './_password-reset.js'

const PROVIDER_LABELS = Object.freeze({
  password: 'Password',
  'google.com': 'Google',
  'apple.com': 'Apple',
  'facebook.com': 'Facebook',
  'github.com': 'GitHub',
  'microsoft.com': 'Microsoft',
  'twitter.com': 'X / Twitter',
  phone: 'Phone',
  anonymous: 'Anonymous',
})

function safeIso(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function normalizeSignInProviders(providerData) {
  if (!Array.isArray(providerData)) return []
  const labels = providerData.flatMap(provider => {
    const id = typeof provider?.providerId === 'string' ? provider.providerId.trim().toLowerCase() : ''
    if (!id) return []
    if (PROVIDER_LABELS[id]) return [PROVIDER_LABELS[id]]
    const safeId = id.replace(/[^a-z0-9.-]/g, '').slice(0, 80)
    return safeId ? [`Other (${safeId})`] : []
  })
  return [...new Set(labels)]
}

export function summarizeInternalEntitlement(entitlement, active) {
  if (!entitlement) return { status: 'not_configured', expiresAt: null }
  if (entitlement.granted !== true) return { status: 'revoked', expiresAt: entitlement.expiresAt || null }
  return { status: active ? 'active' : 'expired', expiresAt: entitlement.expiresAt || null }
}

export function buildAccountSecurityOverview({ authUser, entitlement, entitlementActive }) {
  if (!authUser) {
    return {
      status: 'auth_unavailable',
      reasons: ['Firebase Auth record is unavailable.'],
      authRecord: 'unavailable',
      emailVerification: 'unavailable',
      signInProviders: [],
      passwordSignIn: 'unsupported',
      accountCreatedAt: null,
      lastSignInAt: null,
      lastRefreshAt: null,
      firebaseDisabled: null,
      platformAccess: 'unavailable',
      internalEntitlement: summarizeInternalEntitlement(entitlement, entitlementActive),
    }
  }

  const signInProviders = normalizeSignInProviders(authUser.providerData)
  const disabled = authUser.disabled === true
  const reasons = []
  let status = 'normal'
  if (disabled) {
    status = 'access_restricted'
    reasons.push('Firebase Auth access is disabled.')
  } else {
    if (authUser.emailVerified !== true) reasons.push('Email address is not verified.')
    if (signInProviders.length === 0) reasons.push('No supported sign-in provider is available.')
    if (reasons.length) status = 'attention_required'
  }

  return {
    status,
    reasons,
    authRecord: 'available',
    emailVerification: authUser.emailVerified === true ? 'verified' : 'unverified',
    signInProviders,
    passwordSignIn: supportsPasswordSignIn(authUser) ? 'available' : 'unsupported',
    accountCreatedAt: safeIso(authUser.metadata?.creationTime),
    lastSignInAt: safeIso(authUser.metadata?.lastSignInTime),
    lastRefreshAt: safeIso(authUser.metadata?.lastRefreshTime),
    firebaseDisabled: disabled,
    platformAccess: disabled ? 'suspended' : 'active',
    internalEntitlement: summarizeInternalEntitlement(entitlement, entitlementActive),
  }
}
