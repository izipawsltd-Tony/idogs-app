// Read-only App Store Connect inventory. Never emits credentials, contacts,
// reviewer login values, screenshots or full API response bodies.
import { createPrivateKey, sign } from 'node:crypto'
import { writeFileSync } from 'node:fs'

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
async function get(path, required = false) {
  if (!path.startsWith('/v1/')) throw new Error('UNEXPECTED_API_PATH')
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method: 'GET', headers: { Authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) {
    errors.push({ path: path.split('?')[0], status: response.status })
    if (required) throw new Error(`ASC_REQUIRED_READ_FAILED_${response.status}`)
    return null
  }
  const result = await response.json()
  if (result.links?.next) errors.push({ path: path.split('?')[0], status: 'PAGINATED_NOT_COMPLETE' })
  return result.data
}
const filled = value => typeof value === 'string' && value.trim().length > 0
const list = value => Array.isArray(value) ? value : []

const app = await get(`/v1/apps/${APP_ID}`, true)
if (app.id !== APP_ID || app.attributes?.bundleId !== EXPECTED_BUNDLE) throw new Error('ASC_APP_IDENTITY_MISMATCH')
const builds = list(await get(`/v1/builds?filter[app]=${APP_ID}&filter[version]=20&limit=10`))
const infos = list(await get(`/v1/apps/${APP_ID}/appInfos?limit=20`))
const versions = list(await get(`/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=20`))
const report = {
  checkedAt: new Date().toISOString(), method: 'GET_ONLY',
  app: { id: app.id, bundleId: app.attributes.bundleId, name: app.attributes.name, primaryLocale: app.attributes.primaryLocale },
  build20: builds.map(b => ({ id: b.id, version: b.attributes.version, processingState: b.attributes.processingState,
    expired: b.attributes.expired, usesNonExemptEncryption: b.attributes.usesNonExemptEncryption })),
  appInfos: [], versions: [], errors,
  notVerified: ['App Privacy labels and legal agreements in the portal', 'App Store availability and pricing', 'Actual reviewer login success', 'Screenshot visual content'],
}

for (const info of infos) {
  const locales = list(await get(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`))
  const age = await get(`/v1/appInfos/${info.id}/ageRatingDeclaration`)
  report.appInfos.push({ id: info.id, state: info.attributes?.appStoreState,
    ageRatingDeclarationPresent: !!age,
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
