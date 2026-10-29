import { safeAppReturnTo } from './returnTo'
export function discoveryRoute(path: string): boolean {
  return ['/app/start', '/app/dashboard', '/app/settings', '/app/dogs', '/app/following-puppies'].includes(path) || /^\/app\/puppy-updates\/[^/?]+$/.test(path)
}
export function signupDestination(next?: string | null): string {
  if (next && /^\/p\/[A-Za-z0-9_-]{1,128}(?:\?follow=1)?$/.test(next)) return next
  const puppy = next?.match(/^\/app\/puppy-updates\/([A-Za-z0-9_-]{1,128})(\?follow=1)?$/)
  if (puppy) return `/p/${puppy[1]}${puppy[2] || ''}`
  const target = safeAppReturnTo(next)
  return target === '/app/start' ? '/app/dashboard' : target
}
export function splitDisplayName(name: string) {
  const [firstName = '', ...rest] = name.trim().split(/\s+/)
  return { firstName, lastName: rest.join(' ') }
}
