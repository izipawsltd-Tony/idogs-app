import { makeChecker } from './_lib/test-check.mjs'
import { createFakeFirestore } from './test-helpers/fake-firestore.mjs'
import {
  normalizeBreederId,
  normalizePhone,
  normalizeEmail,
  breederIdentity,
  relatedTenantIdsForBreederTx,
} from '../api/_lib/breeder-profile.js'

const { check, checkAsync, summary } = makeChecker()

check('breeder id normalization ignores spaces/punctuation/case', normalizeBreederId(' daco-12 34 ') === 'DACO1234')
check('AU mobile normalization converges 04 and +61 forms', normalizePhone('0412 345 678') === normalizePhone('+61 412 345 678'))
check('email normalization lowercases/trims', normalizeEmail(' Test@Example.COM ') === 'test@example.com')

const a = breederIdentity({ breederIdType: 'DACO_SA', breederIdValue: 'DACO-1234', phone: '0411111111', email: 'a@example.com' }, { uid: 'u1' })
const b = breederIdentity({ breederIdType: 'DACO_SA', breederIdValue: 'daco 1234', phone: '0499999999', email: 'b@example.com' }, { uid: 'u2' })
check('same normalized breeder id -> same breederProfileId across accounts', a.breederProfileId === b.breederProfileId)
check('breeder id has precedence over phone/email', a.kind === 'breeder_id')

const phoneA = breederIdentity({ phone: '0412 345 678', email: 'a@example.com' }, { uid: 'u1' })
const phoneB = breederIdentity({ phone: '+61 412 345 678', email: 'b@example.com' }, { uid: 'u2' })
check('same normalized phone -> same fallback breederProfileId', phoneA.breederProfileId === phoneB.breederProfileId)

const emailA = breederIdentity({ email: 'Breeder@Example.com' }, { uid: 'u1' })
const emailB = breederIdentity({ email: ' breeder@example.COM ' }, { uid: 'u2' })
check('same normalized email -> same fallback breederProfileId', emailA.breederProfileId === emailB.breederProfileId)

await checkAsync('related UID bridge finds same stored Breeder ID and excludes different ID', async () => {
  const db = createFakeFirestore({ users: {
    oldUid: { breederIdType: 'DACO_SA', breederIdValue: 'DACO1234', phone: '0411000000' },
    newUid: { breederIdType: 'DACO_SA', breederIdValue: 'DACO1234', phone: '0499000000' },
    other: { breederIdType: 'DACO_SA', breederIdValue: 'DACO9999', phone: '0411000000' },
  } })
  const scope = await db.runTransaction(tx => relatedTenantIdsForBreederTx(tx, db, {
    uid: 'newUid',
    profile: { breederIdType: 'DACO_SA', breederIdValue: 'DACO1234', phone: '0499000000' },
  }))
  return scope.identityKind === 'breeder_id' && scope.tenantIds.includes('oldUid') && scope.tenantIds.includes('newUid') && !scope.tenantIds.includes('other')
})

await checkAsync('phone bridge is used only when Breeder ID is absent', async () => {
  const db = createFakeFirestore({ users: {
    u1: { phone: '0412345678', email: 'a@example.com' },
    u2: { phone: '0412345678', email: 'b@example.com' },
  } })
  const scope = await db.runTransaction(tx => relatedTenantIdsForBreederTx(tx, db, {
    uid: 'u2', profile: { phone: '0412345678', email: 'b@example.com' },
  }))
  return scope.identityKind === 'phone' && scope.tenantIds.length === 2
})

await summary()
