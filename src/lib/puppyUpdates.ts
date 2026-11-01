import { auth } from './firebase'

export type UpdateAudience = 'internal' | 'public' | 'buyer'
export interface PuppyUpdate { id: string; text: string; date: string; audience: UpdateAudience; inherited: boolean; media: { id: string; kind: 'photo' | 'video'; url: string }[] }
export interface PuppyStory { dog: { name: string; breed: string; passportId: string }; dogId?: string; role: 'owner' | 'buyer' | 'public'; following: boolean; publicEnabled: boolean; updates: PuppyUpdate[]; nextCursor?: string | null; order?: 'newest' | 'oldest' }
export interface FollowedPuppy { passportId: string; name: string; breed: string; followedAt: string }

export async function puppyUpdates<T = PuppyStory>(body: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser
  const token = user ? await user.getIdToken() : null
  const response = await fetch('/api/puppy-updates', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Could not load puppy updates. Please retry.')
  return data as T
}

export const puppyPath = (passportId: string) => `/p/${encodeURIComponent(passportId)}`
export const puppyAppPath = (passportId: string) => `/app/puppy-updates/${encodeURIComponent(passportId)}`

export const CANONICAL_PUBLIC_ORIGIN = 'https://idogs.com.au'
const STAGING_NATIVE_QA_ORIGIN = 'https://idogs-puppy-journey-qa-izipawsltd-tonys-projects.vercel.app'

/**
 * Link encoded in printed/shared QR codes. Production builds ALWAYS use the
 * canonical customer domain, whatever host the page was opened on (Vercel
 * alias, deployment URL, www) — a printed QR must never point at a temporary
 * or non-canonical host. Staging builds keep their own origin for QA.
 */
export function puppyShareUrl(passportId: string, env: { projectId?: string; native?: string; origin?: string } = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  native: typeof document !== 'undefined' ? document.documentElement.dataset.idogsNativePlatform : undefined,
  origin: typeof window !== 'undefined' ? window.location.origin : undefined,
}): string {
  const staging = env.projectId === 'idogs-app-staging'
  const base = !staging ? CANONICAL_PUBLIC_ORIGIN : env.native ? STAGING_NATIVE_QA_ORIGIN : (env.origin || CANONICAL_PUBLIC_ORIGIN)
  return `${base}${puppyPath(passportId)}`
}
