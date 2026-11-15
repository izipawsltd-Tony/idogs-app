import type { User } from 'firebase/auth'

// Account creation succeeds even if a welcome email is unavailable.
export async function welcomeUser(user: User): Promise<void> {
  try {
    const token = await user.getIdToken()
    await fetch('/api/welcome-user', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
  } catch { /* Best effort; never interrupt signup or following a puppy. */ }
}
