// Read-only App Store Connect inventory. Never emits credentials, contacts,
// reviewer login values, screenshots or full API response bodies.
import { createPrivateKey, sign } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ORIGIN = 'https://api.appstoreconnect.apple.com'
const list = value => Array.isArray(value) ? value : []
const code = value => typeof value === 'string' && /^[A-Z0-9_+.-]{1,60}$/.test(value) ? value : null
const related = (row, name) => row?.relationships?.[name]?.data?.id

// One origin, no redirects, GET only. Pagination cannot change the endpoint or
// continue indefinitely; incomplete reads never establish a release assertion.
export function createReadonlyReader({ fetchImpl = fetch, authorization, errors }) {
  async function page(path, required = false) {
    const url = new URL(path, ORIGIN)
    if (url.origin !== ORIGIN || url.username || url.password || url.hash || !/^\/v[12]\//.test(url.pathname)) throw new Error('UNEXPECTED_API_PATH')
    const response = await fetchImpl(url.href, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${authorization()}` }, signal: AbortSignal.timeout(30000) })
    if (!response.ok) {
      errors.push({ path: url.pathname, status: response.status })
      if (required) throw new Error(`ASC_REQUIRED_READ_FAILED_${response.status}`)
      return null
    }
    return response.json()
  }
  async function collection(path) {
    const expected = new URL(path, ORIGIN).pathname
    const seen = new Set(), data = [], included = []
    let next = path, expectedTotal = null
    for (let n = 0; next && n < 10; n++) {
      const url = new URL(next, ORIGIN)
      if (url.origin !== ORIGIN || url.pathname !== expected || seen.has(url.href)) throw new Error('ASC_UNSAFE_PAGINATION')
      seen.add(url.href)
      const result = await page(url.href)
      if (!result || !Array.isArray(result.data)) return null
      if (result.meta?.paging?.total !== undefined) {
        const total = result.meta.paging.total
        if (!Number.isInteger(total) || total < 0 || total > 1000 || (expectedTotal !== null && expectedTotal !== total)) throw new Error('ASC_COLLECTION_TOTAL_CHANGED')
        expectedTotal = total
      }
      data.push(...result.data); included.push(...list(result.included))
      if (data.length > 1000) throw new Error('ASC_COLLECTION_LIMIT')
      next = result.links?.next
    }
    if (next) { errors.push({ path: expected, status: 'PAGINATION_LIMIT' }); return null }
    if (expectedTotal !== null && expectedTotal !== data.length) { errors.push({ path: expected, status: 'INCOMPLETE_COLLECTION' }); return null }
    return { data, included, complete: true }
  }
  return { page, collection }
}

export function summarizeAvailability(resource, collection) {
  const availableInNewTerritories = typeof resource?.attributes?.availableInNewTerritories === 'boolean' ? resource.attributes.availableInNewTerritories : null
  const rows = collection?.data
  const valid = collection?.complete === true && Array.isArray(rows) && rows.length > 0 &&
    rows.every(r => r.type === 'territoryAvailabilities' && /^[A-Z]{3}$/.test(related(r, 'territory') || '') && typeof r.attributes?.available === 'boolean') &&
    new Set(rows.map(r => related(r, 'territory'))).size === rows.length
  const availableTerritories = valid ? rows.filter(r => r.attributes.available).map(r => related(r, 'territory')).sort() : null
  return { complete: !!valid, availableInNewTerritories, availableTerritories,
    australiaOnlyConfigured: valid && availableInNewTerritories !== null ? availableInNewTerritories === false && availableTerritories.length === 1 && availableTerritories[0] === 'AUS' : null,
    publicReleaseVerified: false }
}

export function summarizeAustralianPrice(manual, automatic, checkedAt) {
  const complete = manual?.complete === true && automatic?.complete === true
  const point = new Map([...list(manual?.included), ...list(automatic?.included)].filter(r => r.type === 'appPricePoints').map(r => [r.id, r]))
  const territories = [...list(manual?.included), ...list(automatic?.included)].filter(r => r.type === 'territories' && r.id === 'AUS')
  const currencyValid = territories.length > 0 && territories.every(r => r.attributes?.currency === 'AUD')
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
  const day = new Date(checkedAt).toISOString().slice(0, 10)
  const raw = [...list(manual?.data), ...list(automatic?.data)]
  const points = [...list(manual?.included), ...list(automatic?.included)].filter(r => r.type === 'appPricePoints')
  const pointsConsistent = points.every(r => point.get(r.id)?.attributes?.customerPrice === r.attributes?.customerPrice)
  const valid = complete && currencyValid && pointsConsistent && new Set(raw.map(r => r.id)).size === raw.length && raw.every(r => r.type === 'appPrices' && related(r, 'territory') === 'AUS' &&
    (r.attributes?.startDate === null || date(r.attributes?.startDate)) && (r.attributes?.endDate === null || date(r.attributes?.endDate)) &&
    (r.attributes.startDate === null || r.attributes.endDate === null || r.attributes.startDate < r.attributes.endDate) &&
    typeof point.get(related(r, 'appPricePoint'))?.attributes?.customerPrice === 'string' && /^\d+(\.\d+)?$/.test(point.get(related(r, 'appPricePoint')).attributes.customerPrice))
  const prices = valid ? raw.map(r => ({ startDate: r.attributes.startDate, endDate: r.attributes.endDate,
    customerPrice: point.get(related(r, 'appPricePoint')).attributes.customerPrice })) : null
  const current = prices?.filter(p => (!p.startDate || p.startDate <= day) && (!p.endDate || day < p.endDate)) || []
  // Apple price dates lack a timezone here. Near a boundary the UTC window
  // alone cannot establish the price currently shown on the Australian store.
  const dateBoundaryUnambiguous = valid && prices.every(p => [p.startDate, p.endDate].every(d => d === null || Math.abs(Date.parse(d) - Date.parse(day)) > 86400000))
  return { territory: 'AUS', currency: valid ? 'AUD' : null, complete: !!valid, checkedDateUTC: day, prices,
    currentFreeDownloadVerified: dateBoundaryUnambiguous && current.length === 1 ? Number(current[0].customerPrice) === 0 : null,
    currentPriceUnique: valid ? current.length === 1 : null, dateBoundaryUnambiguous, timezoneBoundaryVerified: false }
}

export function summarizeAge(info, declaration, territoryRatings) {
  const rows = territoryRatings?.complete ? list(territoryRatings.data).filter(r => r.type === 'territoryAgeRatings' && related(r, 'territory') === 'AUS') : []
  const australiaAppStoreAgeRating = rows.length === 1 ? code(rows[0].attributes?.appStoreAgeRating) : null
  return { appStoreAgeRating: code(info?.attributes?.appStoreAgeRating), australiaAgeRating: code(info?.attributes?.australiaAgeRating),
    ageRatingOverrideV2: code(declaration?.attributes?.ageRatingOverrideV2), australiaAppStoreAgeRating,
    australia18PlusVerified: australiaAppStoreAgeRating ? australiaAppStoreAgeRating === 'EIGHTEEN_PLUS' : null,
    override18PlusConfigured: declaration?.attributes?.ageRatingOverrideV2 ? declaration.attributes.ageRatingOverrideV2 === 'EIGHTEEN_PLUS' : null }
}

async function main() {

const APP_ID = '6823094602'
const EXPECTED_BUNDLE = 'au.com.idogs.app'
const keyId = process.env.APPLE_KEY_ID
const issuer = process.env.APPLE_ISSUER_ID
const encodedKey = process.env.APPLE_API_KEY_P8_BASE64
if (!keyId || !issuer || !encodedKey) throw new Error('APPLE_AUTH_CONFIGURATION_MISSING')
const key = createPrivateKey(Buffer.from(encodedKey, 'base64').toString('utf8'))
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url')
function token() {
  const iat = Math.floor(Date.now() / 1000)
  const unsigned = `${b64({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${b64({ iss: issuer, iat, exp: iat + 600, aud: 'appstoreconnect-v1' })}`
  return `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`
}

const errors = []
const reader = createReadonlyReader({ authorization: token, errors })
async function get(path, required = false) {
  let result
  try { result = await reader.page(path, required) } catch {
    if (required) throw new Error('ASC_REQUIRED_READ_UNAVAILABLE')
    errors.push({ path: path.split('?')[0], status: 'READ_UNAVAILABLE' }); return null
  }
  if (!result) return null
  if (result.links?.next) errors.push({ path: path.split('?')[0], status: 'PAGINATED_NOT_COMPLETE' })
  return result.data
}
async function optionalCollection(path) {
  try { return await reader.collection(path) } catch {
    errors.push({ path: path.split('?')[0], status: 'UNSAFE_OR_UNAVAILABLE_COLLECTION' }); return null
  }
}
const filled = value => typeof value === 'string' && value.trim().length > 0

const app = await get(`/v1/apps/${APP_ID}`, true)
if (app.id !== APP_ID || app.attributes?.bundleId !== EXPECTED_BUNDLE) throw new Error('ASC_APP_IDENTITY_MISMATCH')
const builds = list(await get(`/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=5`))
const infos = list(await get(`/v1/apps/${APP_ID}/appInfos?limit=20`))
const versions = list(await get(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=20`))
const report = {
  checkedAt: new Date().toISOString(), method: 'GET_ONLY',
  app: { id: app.id, bundleId: app.attributes.bundleId, name: app.attributes.name, primaryLocale: app.attributes.primaryLocale },
  recentBuilds: builds.map(b => ({ id: b.id, version: b.attributes.version, processingState: b.attributes.processingState,
    expired: b.attributes.expired, usesNonExemptEncryption: b.attributes.usesNonExemptEncryption })),
  appInfos: [], versions: [], errors,
  notVerified: ['App Privacy labels and legal agreements in the portal', 'Actual reviewer login success', 'Screenshot visual content', 'Public release and territory-specific price date-boundary semantics'],
}

const availability = await get(`/v1/apps/${APP_ID}/appAvailabilityV2`)
const territoryAvailability = availability?.id ? await optionalCollection(`/v2/appAvailabilities/${encodeURIComponent(availability.id)}/territoryAvailabilities?include=territory&limit=50`) : null
report.availability = summarizeAvailability(availability, territoryAvailability)
const schedule = await get(`/v1/apps/${APP_ID}/appPriceSchedule`)
const priceQuery = '?filter[territory]=AUS&include=appPricePoint,territory&fields[appPricePoints]=customerPrice&fields[territories]=currency&limit=200'
const manual = schedule?.id ? await optionalCollection(`/v1/appPriceSchedules/${encodeURIComponent(schedule.id)}/manualPrices${priceQuery}`) : null
const automatic = schedule?.id ? await optionalCollection(`/v1/appPriceSchedules/${encodeURIComponent(schedule.id)}/automaticPrices${priceQuery}`) : null
report.australianPrice = summarizeAustralianPrice(manual, automatic, report.checkedAt)
if (report.availability.australiaOnlyConfigured === null) report.notVerified.push('Australia-only availability configuration')
if (report.australianPrice.currentFreeDownloadVerified === null) report.notVerified.push('Current Australian free-download price')

for (const info of infos) {
  const locales = list(await get(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`))
  const age = await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`)
  const territoryRatings = await optionalCollection(`/v1/appInfos/${info.id}/territoryAgeRatings?include=territory&limit=200`)
  const ageSummary = summarizeAge(info, age, territoryRatings)
  if (ageSummary.australia18PlusVerified === null) report.notVerified.push(`Calculated Australian age rating for appInfo ${info.id}`)
  report.appInfos.push({ id: info.id, state: info.attributes?.appStoreState,
    ageRatingDeclarationPresent: !!age,
    age: ageSummary,
    locales: locales.map(l => ({ locale: l.attributes.locale, namePresent: filled(l.attributes.name),
      subtitlePresent: filled(l.attributes.subtitle), privacyPolicyUrlPresent: filled(l.attributes.privacyPolicyUrl) })),
  })
}
for (const version of versions) {
  const a = version.attributes
  const locales = list(await get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`))
  const review = await get(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`)
  const selectedBuild = await get(`/v1/appStoreVersions/${version.id}/build`)
  const r = review?.attributes || {}
  const summary = { id: version.id, version: a.versionString, state: a.appStoreState, releaseType: a.releaseType,
    copyrightPresent: filled(a.copyright), selectedBuildVersion: selectedBuild?.attributes?.version || null,
    review: { exists: !!review, contactConfigured: ['contactFirstName', 'contactLastName', 'contactPhone', 'contactEmail'].every(k => filled(r[k])),
      demoAccountRequired: r.demoAccountRequired ?? null, demoCredentialsConfigured: filled(r.demoAccountName) && filled(r.demoAccountPassword), notesPresent: filled(r.notes) },
    locales: [],
  }
  for (const locale of locales) {
    const l = locale.attributes
    const sets = list(await get(`/v1/appStoreVersionLocalizations/${locale.id}/appScreenshotSets?limit=50`))
    const screenshots = []
    for (const set of sets) {
      const shots = list(await get(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`))
      screenshots.push({ displayType: set.attributes?.screenshotDisplayType, count: shots.length,
        completed: shots.filter(s => s.attributes?.assetDeliveryState?.state === 'COMPLETE').length })
    }
    summary.locales.push({ locale: l.locale, descriptionPresent: filled(l.description), keywordsPresent: filled(l.keywords),
      supportUrlPresent: filled(l.supportUrl), marketingUrlPresent: filled(l.marketingUrl), screenshots })
  }
  report.versions.push(summary)
}
// Only this explicit allowlisted summary is persisted; raw API objects stay in memory.
const output = JSON.stringify(report, null, 2)
writeFileSync('app-store-readiness.json', output + '\n', { mode: 0o600 })
console.log(output)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
