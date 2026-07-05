export const SUPER_ADMIN_BASE_PATH = '/app/super-admin'

export const SUPER_ADMIN_EMAILS = [
  'trunghieungo@gmail.com',
  'theresanguyenngo@gmail.com',
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
        description: 'Tenant and kennel overview',
      },
      {
        label: 'Users',
        path: `${SUPER_ADMIN_BASE_PATH}/users`,
        description: 'Platform account overview',
      },
    ],
  },
  {
    label: 'Revenue',
    items: [
      {
        label: 'Subscriptions',
        path: `${SUPER_ADMIN_BASE_PATH}/subscriptions`,
        description: 'Read-only subscription and plan overview',
      },
      {
        label: 'Billing & Payments',
        path: `${SUPER_ADMIN_BASE_PATH}/billing-payments`,
        description: 'Future billing and payment review',
      },
      {
        label: 'Plans & Pricing',
        path: `${SUPER_ADMIN_BASE_PATH}/plans-pricing`,
        description: 'Read-only plan catalogue and usage',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        label: 'Support',
        path: `${SUPER_ADMIN_BASE_PATH}/support`,
        description: 'Read-only support signals (no ticket system yet)',
      },
      {
        label: 'Audit Logs',
        path: `${SUPER_ADMIN_BASE_PATH}/audit-logs`,
        description: 'Read-only platform activity trail',
      },
    ],
  },
  {
    label: 'System',
    items: [
      {
        label: 'Settings',
        path: `${SUPER_ADMIN_BASE_PATH}/settings`,
        description: 'Read-only platform configuration and safety overview',
      },
    ],
  },
]

export function isSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false
  return SUPER_ADMIN_EMAILS.includes(email.trim().toLowerCase() as typeof SUPER_ADMIN_EMAILS[number])
}
