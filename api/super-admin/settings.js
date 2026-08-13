// api/super-admin/settings.js — Read-only platform configuration & safety overview
//
// Read-only. Returns only safe, non-secret metadata: the Firebase project id
// (already public in the client bundle via VITE_FIREBASE_PROJECT_ID — not a
// secret), the Vercel deployment context, and static descriptions of module/
// integration/security status. Never returns private keys, client emails,
// tokens, or any other credential material.
import { verifySuperAdmin, ALLOWED_ADMINS } from './_auth.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 1. Enforce Server-Side Super Admin Authorization
  const adminUser = await verifySuperAdmin(req, res)
  if (!adminUser) return

  try {
    const now = new Date()

    // Vercel sets VERCEL_ENV to 'production' | 'preview' | 'development' when
    // running on Vercel (including `vercel dev` locally, which reports
    // 'development'). Plain `vite`/`node` runs have no VERCEL_ENV at all.
    const vercelEnv = process.env.VERCEL_ENV || null
    const nodeEnv = process.env.NODE_ENV || 'unknown'
    const firebaseProjectId = process.env.FIREBASE_PROJECT_ID || null

    let deploymentTarget = 'Unknown'
    if (vercelEnv === 'production') deploymentTarget = 'Production'
    else if (vercelEnv === 'preview') deploymentTarget = 'Staging / Preview'
    else if (vercelEnv === 'development') deploymentTarget = 'Local (vercel dev)'

    const environment = {
      appMode: nodeEnv,
      firebaseProjectId,
      apiRoutingStatus: 'Vercel serverless functions under /api (vercel.json bypasses the SPA rewrite for /api/*)',
      deploymentTarget,
      productionStatus: 'Protected — not editable from this console',
      lastCheckedAt: now.toISOString(),
    }

    const superAdminAccess = {
      allowlistedEmails: ALLOWED_ADMINS,
      emailVerificationRequired: true,
      serverSideAllowlistEnforced: true,
      frontendGatePresent: true,
      warning: 'Allowlist management is disabled in V1. Changes require code review and Tony approval.',
    }

    const securityGuardrails = [
      { label: 'Server-side Firebase ID token verification', met: true },
      { label: 'Email verified required', met: true },
      { label: 'Super Admin allowlist required (server-side)', met: true },
      { label: 'No browser cross-tenant Firestore reads', met: true },
      { label: 'Read-only admin modules built so far', met: true },
      { label: 'Production deployment disabled by workflow', met: true },
      { label: 'Payment actions disabled', met: true },
    ]

    const moduleStatus = [
      { name: 'Dashboard', status: 'Active' },
      { name: 'Organisations', status: 'Read-only active' },
      { name: 'Users', status: 'Read-only active' },
      { name: 'Subscriptions', status: 'Read-only active' },
      { name: 'Plans & Pricing', status: 'Read-only active' },
      { name: 'Audit Logs', status: 'Read-only active' },
      { name: 'Support', status: 'Read-only signals only' },
      { name: 'Billing & Payments', status: 'Placeholder / Disabled' },
      { name: 'Platform Settings', status: 'Read-only active' },
    ]

    const integrations = [
      { name: 'Firebase Auth', status: firebaseProjectId ? 'Configured' : 'Unknown' },
      { name: 'Firestore', status: 'Read-only via server APIs' },
      { name: 'Vercel API routing', status: 'Configured' },
      { name: 'Stripe', status: 'Disabled / Not connected from Super Admin' },
      { name: 'Email sending', status: 'Disabled / Not connected from Super Admin' },
      { name: 'Support tool', status: 'Not connected' },
    ]

    const deploymentChecklist = [
      'Build passes',
      'API guards return JSON 401 without auth',
      'Logged-in Super Admin browser QA completed',
      'Non-admin access denied',
      'No .env.local staged',
      'No service account JSON in repo',
      'No production env modified',
      'Tony approved deployment',
    ]

    const notices = [
      'Read-only settings view. Platform configuration changes are disabled in V1.',
      'Staging-first workflow. Production changes require explicit Tony approval.',
    ]

    return res.status(200).json({
      settings: {
        environment,
        superAdminAccess,
        securityGuardrails,
        moduleStatus,
        integrations,
        deploymentChecklist,
        notices,
      },
    })
  } catch (error) {
    console.error('Failed to compile settings overview:', error)
    return res.status(500).json({ error: 'Failed to compile settings overview', message: error.message })
  }
}
