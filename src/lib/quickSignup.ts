import { safeAppReturnTo } from './returnTo'
export function discoveryRoute(path: string): boolean {
  return path === '/app/start' || path === '/app/following-puppies' || /^\/app\/puppy-updates\/[^/?]+$/.test(path)
}
export function signupDestination(next?: string | null): string {
  return next ? safeAppReturnTo(next) : '/app/start'
}
export function splitDisplayName(name: string) {
  const [firstName = '', ...rest] = name.trim().split(/\s+/)
  return { firstName, lastName: rest.join(' ') }
}
