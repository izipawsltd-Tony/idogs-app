import fs from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import {
  LITTER_INCLUDED_QUOTA,
  EXTRA_LITTER_PRICE_AUD as SERVER_EXTRA_LITTER_PRICE_AUD,
  EXTRA_LITTER_PRICE_CENTS,
} from '../api/_lib/litter-quota.js'

const { check, summary } = makeChecker()

const pricing = fs.readFileSync(new URL('../src/lib/pricingCopy.ts', import.meta.url), 'utf8')
const billing = fs.readFileSync(new URL('../src/pages/BillingPage.tsx', import.meta.url), 'utf8')
const landing = fs.readFileSync(new URL('../src/pages/LandingPage.tsx', import.meta.url), 'utf8')
const terms = fs.readFileSync(new URL('../src/pages/TermsPage.tsx', import.meta.url), 'utf8')
const cta = fs.readFileSync(new URL('../src/components/ExtraLitterButton.tsx', import.meta.url), 'utf8')
const littersPage = fs.readFileSync(new URL('../src/pages/LittersPage.tsx', import.meta.url), 'utf8')
const checkout = fs.readFileSync(new URL('../api/_lib/extra-litter-checkout-handler.js', import.meta.url), 'utf8')

check('Plus monthly policy is A$7', pricing.includes('PLUS_MONTHLY_PRICE_AUD = 7'))
check('Plus annual policy is A$70', pricing.includes('PLUS_ANNUAL_PRICE_AUD = 70'))
check('client Plus litter allowance is 2', pricing.includes('LITTER_QUOTA_PLUS_ROLLING_12_MONTHS = 2'))
check('server Plus litter allowance is 2', LITTER_INCLUDED_QUOTA === 2)
check('client/server Extra Litter price is A$39', pricing.includes('EXTRA_LITTER_PRICE_AUD = 39') && SERVER_EXTRA_LITTER_PRICE_AUD === 39 && EXTRA_LITTER_PRICE_CENTS === 3900)
check('Billing advertises 2 rolling litters', billing.includes('2 litters per rolling 12 months'))
check('Billing advertises Extra Litter A$39', billing.includes('Extra litters A$39 each'))
check('Landing no longer advertises A$5', !landing.includes('Plans from A$5/month'))
check('Landing advertises A$7', landing.includes('Plans from A$7/month'))
check('Landing advertises 2 litters and A$39 extras', landing.includes('2 litters per rolling 12 months included') && landing.includes('Extra litters A$39 each'))
check('Terms state breeder-profile quota does not reset', terms.includes('Cancelling, downgrading, or resubscribing does not reset litter usage'))
check('Terms describe one-time Extra Litter A$39 policy', terms.includes('Extra Litter Credit — A${EXTRA_LITTER_PRICE_AUD} each'))
check('CTA text is Add another litter — A$39', cta.includes('Add another litter — A$${summary.extraLitterPriceAud}'))
check('CTA is gated on included exhaustion', cta.includes('includedExhausted') && cta.includes('if (!includedExhausted || hasUnusedExtraCredit)'))
check('quota UX reports included litters remaining', cta.includes('included litter${remaining === 1 ? \'\' : \'s\'} remaining') && cta.includes('No included litters remaining'))
check('quota UX no longer says allowances used', !cta.includes('litter allowances used'))
check('quota UX explains rolling breeder-profile history', cta.includes('Based on your breeder profile’s rolling 12-month litter history'))
check('server blocks purchase while included slots remain', checkout.includes("code: 'INCLUDED_LITTERS_REMAIN'"))
check('server blocks purchase while unused credit exists', checkout.includes("code: 'EXTRA_LITTER_CREDIT_AVAILABLE'"))
check('finance gate remains opt-in only', checkout.includes("process.env.EXTRA_LITTER_CHECKOUT_ENABLED === 'true'"))
check('empty-state clarifies current-account scope', littersPage.includes('No litters in this account yet'))
check('empty-state CTA avoids misleading first-litter wording', littersPage.includes('Create a litter here to start tracking puppies from birth to new homes.') && littersPage.includes('>Create litter</button>'))
check('legacy first-litter empty-state wording is absent', !littersPage.includes('No litters yet') && !littersPage.includes('Create your first litter to track puppies from birth to new homes.') && !littersPage.includes('>Create first litter</button>'))

await summary()
