export const SUPER_ADMIN_BASE_PATH = '/app/super-admin'

export const SUPER_ADMIN_EMAILS = [
  'trunghieungo@gmail.com',
] as const

export type SuperAdminNavSection = {
  label: string
  items: Array<{
    label: string
    path: string
    description: string
  }>
}

export const SUPER_ADMIN_NAV: SuperAdminNavSection[] = [
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        path: `${SUPER_ADMIN_BASE_PATH}/dashboard`,
        description: 'Super Admin operating overview',
      },
    ],
  },
  {
    label: 'Management',
    items: [
      {
        label: 'Organisations',
        path: `${SUPER_ADMIN_BASE_PATH}/organisations`,
        description: 'Future tenant and kennel administration',
      },
      {
        label: 'Users',
        path: `${SUPER_ADMIN_BASE_PATH}/users`,
        description: 'Future user account administration',
      },
    ],
  },
  {
    label: 'Revenue',
    items: [
      {
        label: 'Subscriptions',
        path: `${SUPER_ADMIN_BASE_PATH}/subscriptions`,
        description: 'Future subscription operations',
      },
      {
        label: 'Billing & Payments',
        path: `${SUPER_ADMIN_BASE_PATH}/billing-payments`,
        description: 'Future billing and payment review',
      },
      {
        label: 'Plans & Pricing',
        path: `${SUPER_ADMIN_BASE_PATH}/plans-pricing`,
        description: 'Future plan catalogue controls',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        label: 'Support',
        path: `${SUPER_ADMIN_BASE_PATH}/support`,
        description: 'Future support workspace',
      },
      {
        label: 'Audit Logs',
        path: `${SUPER_ADMIN_BASE_PATH}/audit-logs`,
        description: 'Future platform audit review',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        label: 'Settings',
        path: `${SUPER_ADMIN_BASE_PATH}/settings`,
        description: 'Future Super Admin configuration',
      },
    ],
  },
]

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false
  return SUPER_ADMIN_EMAILS.includes(email.trim().toLowerCase() as typeof SUPER_ADMIN_EMAILS[number])
}
