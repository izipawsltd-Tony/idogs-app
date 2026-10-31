import test from 'node:test'
import assert from 'node:assert/strict'
import { createReadonlyReader, summarizeAvailability, summarizeAustralianPrice, summarizeAge } from './qa/app-store-readiness.mjs'

const complete = (data, included = []) => ({ data, included, complete: true })
const availability = (territory, available) => ({ type: 'territoryAvailabilities', attributes: { available }, relationships: { territory: { data: { id: territory } } } })
const autoConfig = { attributes: { availableInNewTerritories: false } }
const price = (id, customerPrice = '0.00', startDate = null, endDate = null) => complete([
  { id, type: 'appPrices', attributes: { startDate, endDate }, relationships: { territory: { data: { id: 'AUS' } }, appPricePoint: { data: { id: 'point' } } } },
], [{ type: 'appPricePoints', id: 'point', attributes: { customerPrice } }, { type: 'territories', id: 'AUS', attributes: { currency: 'AUD' } }])
const now = '2026-10-30T07:00:00Z'

test('availability requires complete unique explicit territory booleans and new-territory opt-out', () => {
  const result = summarizeAvailability(autoConfig, complete([availability('AUS', true), availability('USA', false)]))
  assert.equal(result.australiaOnlyConfigured, true)
  assert.equal(result.publicReleaseVerified, false)
  assert.equal(summarizeAvailability(autoConfig, null).australiaOnlyConfigured, null)
  assert.equal(summarizeAvailability({}, complete([availability('AUS', true)])).australiaOnlyConfigured, null)
  assert.equal(summarizeAvailability(autoConfig, complete([availability('AUS', true), availability('AUS', true)])).australiaOnlyConfigured, null)
  assert.equal(summarizeAvailability(autoConfig, complete([availability('AUS', true), availability('USA', true)])).australiaOnlyConfigured, false)
  assert.equal(summarizeAvailability({ attributes: { availableInNewTerritories: true } }, complete([availability('AUS', true)])).australiaOnlyConfigured, false)
})

test('price resolves scheduled relational price points rather than free points merely offered for sale', () => {
  assert.equal(summarizeAustralianPrice(price('free'), complete([]), now).currentFreeDownloadVerified, true)
  assert.equal(summarizeAustralianPrice(price('paid', '7.00'), complete([]), now).currentFreeDownloadVerified, false)
  assert.equal(summarizeAustralianPrice(price('future', '0', '2026-11-01'), complete([]), now).currentFreeDownloadVerified, null)
  assert.equal(summarizeAustralianPrice(price('expired', '0', null, '2026-10-30'), complete([]), now).currentFreeDownloadVerified, null)
  const missing = price('missing'); missing.data[0].relationships.appPricePoint.data.id = 'absent'
  assert.equal(summarizeAustralianPrice(missing, complete([]), now).currentFreeDownloadVerified, null)
})

test('incomplete, malformed, conflicting and overlapping prices never establish free download', () => {
  for (const manual of [null, price('invalid', 'free'), price('invalid', '0', '2026-99-30'), price('invalid', '0', undefined)]) {
    if (manual?.data?.[0]?.id === 'invalid' && manual.data[0].attributes.startDate === null) delete manual.data[0].attributes.startDate
    assert.equal(summarizeAustralianPrice(manual, complete([]), now).currentFreeDownloadVerified, null)
  }
  assert.equal(summarizeAustralianPrice(price('a'), null, now).currentFreeDownloadVerified, null)
  assert.equal(summarizeAustralianPrice(price('a'), price('b'), now).currentFreeDownloadVerified, null)
  assert.equal(summarizeAustralianPrice(price('a'), price('b', '7.00'), now).currentFreeDownloadVerified, null)
  const foreign = price('a'); foreign.data[0].relationships.territory.data.id = 'USA'
  assert.equal(summarizeAustralianPrice(foreign, complete([]), now).currentFreeDownloadVerified, null)
})

test('age override is separate from calculated Australian territory rating and legacy global 17+', () => {
  const row = value => ({ type: 'territoryAgeRatings', attributes: { appStoreAgeRating: value }, relationships: { territory: { data: { id: 'AUS' } } } })
  const info = { attributes: { appStoreAgeRating: 'SEVENTEEN_PLUS' } }, declaration = { attributes: { ageRatingOverrideV2: 'EIGHTEEN_PLUS' } }
  assert.equal(summarizeAge(info, declaration, null).override18PlusConfigured, true)
  assert.equal(summarizeAge(info, declaration, null).australia18PlusVerified, null)
  assert.equal(summarizeAge(info, declaration, complete([row('EIGHTEEN_PLUS')])).australia18PlusVerified, true)
  assert.equal(summarizeAge(info, declaration, complete([row('FOUR_PLUS')])).australia18PlusVerified, false)
  assert.equal(summarizeAge(info, declaration, complete([row('EIGHTEEN_PLUS'), row('FOUR_PLUS')])).australia18PlusVerified, null)
})

test('reader follows bounded same-endpoint pagination using GET only and no redirects', async () => {
  const calls = [], errors = []
  const reader = createReadonlyReader({ authorization: () => 'synthetic-token', errors, fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return { ok: true, json: async () => new URL(url).searchParams.has('cursor') ? { data: [{ id: 'b' }] } : { data: [{ id: 'a' }], links: { next: 'https://api.appstoreconnect.apple.com/v2/appAvailabilities/qa/territoryAvailabilities?cursor=2' } } }
  } })
  const result = await reader.collection('/v2/appAvailabilities/qa/territoryAvailabilities?limit=200')
  assert.deepEqual(result.data.map(r => r.id), ['a', 'b'])
  assert.ok(calls.every(c => c.options.method === 'GET' && c.options.redirect === 'error'))
  assert.deepEqual(errors, [])
})

test('foreign-origin, endpoint-switch, cyclic and credentialed pagination are rejected before token transmission', async () => {
  for (const next of ['https://evil.invalid/v1/apps', '/v1/users', '/v1/apps?limit=200', 'https://user@api.appstoreconnect.apple.com/v1/apps?cursor=2']) {
    let calls = 0
    const reader = createReadonlyReader({ authorization: () => 'synthetic-token', errors: [], fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ data: [], links: { next } }) } } })
    await assert.rejects(reader.collection('/v1/apps?limit=200'))
    assert.equal(calls, 1)
  }
})

test('failed or truncated collections remain unknown and bounded, without raw provider errors', async () => {
  const errors = []
  const reader = createReadonlyReader({ authorization: () => 'synthetic-token', errors, fetchImpl: async () => ({ ok: false, status: 403 }) })
  assert.equal(await reader.collection('/v1/apps'), null)
  assert.deepEqual(errors, [{ path: '/v1/apps', status: 403 }])
  let calls = 0
  const paginated = createReadonlyReader({ authorization: () => 'synthetic-token', errors, fetchImpl: async () => ({ ok: true, json: async () => ({ data: [], links: { next: `/v1/apps?cursor=${++calls}` } }) }) })
  assert.equal(await paginated.collection('/v1/apps'), null)
  assert.equal(calls, 10)
  assert.equal(errors.at(-1).status, 'PAGINATION_LIMIT')
})

test('reported collection totals catch missing next links instead of proving Australia-only from one partial page', async () => {
  const errors = []
  const reader = createReadonlyReader({ authorization: () => 'synthetic-token', errors, fetchImpl: async () => ({ ok: true, json: async () => ({ data: [availability('AUS', true)], meta: { paging: { total: 175 } } }) }) })
  const result = await reader.collection('/v2/appAvailabilities/qa/territoryAvailabilities')
  assert.equal(result, null)
  assert.equal(summarizeAvailability(autoConfig, result).australiaOnlyConfigured, null)
  assert.equal(errors[0].status, 'INCOMPLETE_COLLECTION')
})

test('scheduled date boundaries near today stay unknown without assuming a provider timezone', () => {
  const free = price('old', '0', null, '2026-10-31')
  const paid = price('new', '7.00', '2026-10-31')
  // Use distinct price point IDs for the two real schedule entries.
  paid.data[0].relationships.appPricePoint.data.id = 'paid-point'; paid.included[0].id = 'paid-point'
  const result = summarizeAustralianPrice(free, paid, now)
  assert.equal(result.currentPriceUnique, true)
  assert.equal(result.dateBoundaryUnambiguous, false)
  assert.equal(result.currentFreeDownloadVerified, null)
})
