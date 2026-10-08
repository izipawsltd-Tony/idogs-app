import fs from 'node:fs'
import assert from 'node:assert/strict'
import {
  PLUS_MONTHLY_PRICE_AUD,
  PLUS_ANNUAL_PRICE_AUD,
  DOG_CAP_FREE,
  DOG_CAP_PLUS,
  SCAN_QUOTA_FREE_LIFETIME,
  SCAN_QUOTA_PLUS_MONTHLY,
  LITTER_QUOTA_PLUS_ROLLING_12_MONTHS,
  EXTRA_LITTER_PRICE_AUD,
} from '../api/_lib/pricing-policy.js'

const clientPricing = fs.readFileSync(new URL('../src/lib/pricingCopy.ts', import.meta.url), 'utf8')
const superAdminPricing = fs.readFileSync(new URL('../api/super-admin/_pricing.js', import.meta.url), 'utf8')
const aiCeo = fs.readFileSync(new URL('../api/_lib/ai-ceo-v12.js', import.meta.url), 'utf8')
const landing = fs.readFileSync(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8')
const dogNew = fs.readFileSync(new URL('../src/pages/DogNewPage.tsx', import.meta.url), 'utf8')

function clientNumber(name) {
  const match = clientPricing.match(new RegExp(`export const ${name} = (\\d+(?:\\.\\d+)?)`))
  assert.ok(match, `client pricing constant ${name} exists`)
  return Number(match[1])
}

assert.equal(clientNumber('PLUS_MONTHLY_PRICE_AUD'), PLUS_MONTHLY_PRICE_AUD)
assert.equal(clientNumber('PLUS_ANNUAL_PRICE_AUD'), PLUS_ANNUAL_PRICE_AUD)
assert.equal(clientNumber('DOG_CAP_FREE'), DOG_CAP_FREE)
assert.equal(clientNumber('DOG_CAP_PLUS'), DOG_CAP_PLUS)
assert.equal(clientNumber('SCAN_QUOTA_FREE_LIFETIME'), SCAN_QUOTA_FREE_LIFETIME)
assert.equal(clientNumber('SCAN_QUOTA_PLUS_MONTHLY'), SCAN_QUOTA_PLUS_MONTHLY)
assert.equal(clientNumber('LITTER_QUOTA_PLUS_ROLLING_12_MONTHS'), LITTER_QUOTA_PLUS_ROLLING_12_MONTHS)
assert.equal(clientNumber('EXTRA_LITTER_PRICE_AUD'), EXTRA_LITTER_PRICE_AUD)

assert.match(superAdminPricing, /from '\.\.\/_lib\/pricing-policy\.js'/)
assert.doesNotMatch(superAdminPricing, /PLUS_MONTHLY_PRICE_AUD\s*=\s*5/)
assert.doesNotMatch(superAdminPricing, /PLUS_ANNUAL_PRICE_AUD\s*=\s*49/)
assert.match(aiCeo, /from '\.\/pricing-policy\.js'/)
assert.doesNotMatch(aiCeo, /billingInterval === 'annual' \? 49 \/ 12 : 5/)
assert.match(landing, /PLUS_MONTHLY_PRICE_AUD/)
assert.doesNotMatch(landing, /<span>A\$7<\/span>/)
assert.match(dogNew, /PLUS_MONTHLY_PRICE_AUD/)
assert.doesNotMatch(dogNew, /Upgrade — from \$5\/mo/)

console.log('Pricing sync checks: PASS')
