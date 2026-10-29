import { signupDestination } from './quickSignup'
export const PENDING_SIGNIN_PREFIX = 'idogs.signin.'
export interface PendingSignin { email: string; name: string; marketingOptIn: boolean; createdAt: number }
export function readPendingSignin(flow: string | null, storage?: Pick<Storage, 'getItem'>): PendingSignin | null {
  if (!flow || !/^[a-zA-Z0-9-]{16,80}$/.test(flow)) return null
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(PENDING_SIGNIN_PREFIX + flow) || 'null')
    return value && typeof value.email === 'string' && typeof value.name === 'string' && Date.now() - value.createdAt < 3600000 && value.createdAt <= Date.now() ? value : null
  } catch { return null }
}
export function emailReturnUrl(origin: string, next: string, flow: string): string {
  const url = new URL('/auth/finish', origin)
  url.searchParams.set('next', signupDestination(next)); url.searchParams.set('flow', flow)
  return url.href
}
export function normalizeSigninPhone(value: string): string {
  let phone = value.replace(/[\s()-]/g, '')
  if (/^04\d{8}$/.test(phone)) phone = '+61' + phone.slice(1)
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Enter an Australian mobile number or include your country code, such as +61.')
  return phone
}
