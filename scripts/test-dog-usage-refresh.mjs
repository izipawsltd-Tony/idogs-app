import { readFileSync } from 'node:fs'
import { makeChecker } from './_lib/test-check.mjs'
import { emitDogUsageChanged, subscribeToDogUsageChanged } from '../src/lib/dogUsageEvents.ts'

const { check, summary } = makeChecker()

const layoutSource = readFileSync(new URL('../src/components/layout/AppLayout.tsx', import.meta.url), 'utf8')
const detailSource = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')

const received = []
const unsubscribe = subscribeToDogUsageChanged(uid => received.push(uid))
emitDogUsageChanged('breeder-a')
check('a successful mutation signal reaches subscribers with its account uid', received.join(',') === 'breeder-a')

unsubscribe()
emitDogUsageChanged('breeder-b')
check('unsubscribed layouts do not receive later account signals', received.join(',') === 'breeder-a')

emitDogUsageChanged('')
check('an empty uid never produces an account-ambiguous signal', received.join(',') === 'breeder-a')

check(
  'AppLayout listens for dog-usage changes and refreshes only the matching authenticated uid',
  layoutSource.includes('subscribeToDogUsageChanged') &&
    layoutSource.includes('if (changedUid === uid) loadDogAndClaimCounts()')
)

check(
  'the shared refresh uses the existing request guard against account-switch races',
  layoutSource.includes('const req = beginDogCountRequest()') &&
    layoutSource.includes('if (!req.isCurrent()) return') &&
    layoutSource.includes('if (req.isCurrent()) setPendingClaimCount')
)

check(
  'all six server-backed status/retention actions share the success-only refresh path',
  detailSource.includes("action: 'activate' | 'restore' | 'restrict' | 'archive' | 'promote' | 'unpromote'") &&
    /async function handleSetDogStatus[\s\S]*?if \(!res\.ok\)[\s\S]*?emitDogUsageChanged\(user\.uid\)[\s\S]*?\} catch \(err\)/.test(detailSource)
)

check(
  'no optimistic increment or decrement was introduced',
  !/setDogCount\s*\(\s*(?:count|prev)\s*=>\s*(?:count|prev)\s*[+-]/.test(layoutSource)
)

summary()
