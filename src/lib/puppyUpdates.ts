import { auth } from './firebase'

export type UpdateAudience = 'internal' | 'public' | 'buyer'
export interface PuppyUpdate { id: string; text: string; date: string; audience: UpdateAudience; inherited: boolean; media: { id: string; kind: 'photo' | 'video'; url: string }[] }
export interface PuppyStory { dog: { name: string; breed: string; passportId: string }; dogId?: string; role: 'owner' | 'buyer' | 'public'; following: boolean; publicEnabled: boolean; updates: PuppyUpdate[]; nextCursor?: string | null }
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

export function puppyShareUrl(passportId: string): string {
  const native = document.documentElement.dataset.idogsNativePlatform
  const base = native ? (import.meta.env.VITE_FIREBASE_PROJECT_ID === 'idogs-app-staging' ? 'https://idogs-puppy-journey-qa-izipawsltd-tonys-projects.vercel.app' : 'https://idogs.com.au') : window.location.origin
  return `${base}${puppyPath(passportId)}`
}
