import { auth } from './firebase'

export type SuperAdminSection = 'dashboard' | 'organisations' | 'users' | 'subscriptions' | 'audit-logs'

export interface SuperAdminUserRow {
  id: string
  email: string
  name: string
  kennelName: string
  role: 'owner' | 'breeder' | 'admin'
  plan: 'free' | 'plus'
  planSource: 'free' | 'stripe' | 'internal'
  subscriptionStatus: string
  billingInterval: '' | 'monthly' | 'annual'
  createdAt: string
  trialEndsAt: string
  state: string
  mrrAud: number
}

export interface SuperAdminOrganisationRow {
  id: string
  name: string
  ownerName: string
  email: string
  state: string
  plan: 'free' | 'plus'
  dogCount: number
  createdAt: string
}

export interface SuperAdminSubscriptionRow {
  userId: string
  email: string
  name: string
  plan: 'free' | 'plus'
  source: 'free' | 'stripe' | 'internal'
  status: string
  interval: '' | 'monthly' | 'annual'
  mrrAud: number
}

export interface SuperAdminAuditRow {
  id: string
  timestamp: string
  actor: string
  action: string
  details: string
  tenantId: string
  dogId: string
}

export interface SuperAdminWorkspaceData {
  generatedAt: string
  adminEmail: string
  metrics: {
    organisations: number
    totalUsers: number
    breeders: number
    owners: number
    paidSubscriptions: number
    activeTrials: number
    mrrAud: number
    churnRate: number | null
  }
  users: SuperAdminUserRow[]
  organisations: SuperAdminOrganisationRow[]
  subscriptions: SuperAdminSubscriptionRow[]
  auditLogs: SuperAdminAuditRow[]
}

export async function fetchSuperAdminWorkspace(): Promise<SuperAdminWorkspaceData> {
  if (!auth.currentUser) throw new Error('Not signed in')
  const idToken = await auth.currentUser.getIdToken()
  const response = await fetch('/api/super-admin-overview', {
    headers: { Authorization: `Bearer ${idToken}` },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Could not load admin data (${response.status})`)
  return body as SuperAdminWorkspaceData
}
