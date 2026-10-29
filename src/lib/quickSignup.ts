import { safeAppReturnTo } from './returnTo'
export function discoveryRoute(path: string): boolean {
  return path === '/app/start' || path === '/app/following-puppies' || /^\/app\/puppy-updates\/[^/?]+$/.test(path)
}
export function signupDestination(next?: string | null): string {
  const target = safeAppReturnTo(next)
  return target === '/app/dashboard' ? '/app/start' : target
}
export function splitDisplayName(name: string) {
  const [firstName = '', ...rest] = name.trim().split(/\s+/)
  return { firstName, lastName: rest.join(' ') }
}
