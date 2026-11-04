import type { Dog, UserProfile } from '../types'
import { DOG_CAP_FREE } from './pricingCopy'
import { getEffectivePlanClient, isDogEligibleForCap } from './utils'

type CapDog = Pick<Dog, 'status' | 'isDeceased' | 'litterId' | 'retainedByBreeder' | 'currentOwnerId' | 'tenantId'>
type PlanProfile = Pick<UserProfile, 'plan' | 'subscriptionStatus' | 'pastDueSince' | 'internalEntitlement'> | null | undefined

/**
 * Free-plan dog usage, using the same rules as Add Dog (DogNewPage) and the
 * server cap: only dogs that count toward the cap, and the EFFECTIVE plan
 * (paid Plus or a valid internal entitlement are never limited here).
 */
export function freeDogUsage(dogs: CapDog[], profile: PlanProfile, now = new Date()) {
  const isFree = getEffectivePlanClient(profile, now) === 'free'
  const used = dogs.filter(isDogEligibleForCap).length
  return { isFree, used, limit: DOG_CAP_FREE, atLimit: isFree && used >= DOG_CAP_FREE }
}
