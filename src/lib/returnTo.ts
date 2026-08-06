// Only internal authenticated app routes may be used as post-auth return
// targets. This prevents an invite/login URL from becoming an open redirect.
export function safeAppReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/app/') || value.startsWith('//') || value.includes('://')) return '/app/dashboard'
  return value
}
