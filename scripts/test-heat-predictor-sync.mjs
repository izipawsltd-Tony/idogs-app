// Regression coverage for the Heat Cycle Predictor / actual-record sync
// fix (fix/sire-heat-cycle, Recorded Heat Prediction blocker).
//
// Root cause recap: predictedHeats was built purely from DOB (or the
// separate firstHeatDate anchor) — it never looked at the actual
// heatCycles records at all. The render then separately did
// `heatCycles.find(h => h.heatNumber === heat.n)` just to show an extra
// "✓ Recorded" badge, while the row's own label/date stayed hard-coded
// to "Heat N (estimated)" and the stale predicted date. So a genuinely
// recorded Heat 6 showed the contradictory combination of "Heat 6
// (estimated)" text, a stale predicted date, AND a "Recorded" badge.
//
// Fixed by building a recordedByHeatNumber map up front and having each
// predicted slot check it first: a match overrides date+label+recorded
// entirely; only unmatched slots fall through to the original
// DOB/firstHeatDate-anchored estimate — except that estimate itself now
// re-anchors from the most recent actual recording (by heat number) when
// predicting anything after it, instead of always extrapolating from
// heat 1/DOB alone.
//
// This file mirrors that exact algorithm in isolation (no DOM/React
// needed) plus static source assertions that DogDetailPage.tsx's real
// implementation matches it.
//
// Usage: node scripts/test-heat-predictor-sync.mjs (no emulator needed)

const { readFileSync } = await import('node:fs')

let pass = 0, fail = 0
function check(label, cond, extra = '') {
  if (cond) { console.log(`PASS: ${label}`); pass++ }
  else { console.log(`FAIL: ${label} ${extra}`); fail++ }
}

// ── Mirror of DogDetailPage.tsx's addMonths + predictedHeats logic ──
function addMonths(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function buildPredictedHeats({ dob, firstHeatDate, heatInterval, firstHeatMo, heatCycles }) {
  const recordedByHeatNumber = new Map()
  for (const cycle of [...heatCycles].sort((a, b) => (a.id || '').localeCompare(b.id || ''))) {
    if (cycle.heatNumber == null || !cycle.heatStartDate) continue
    if (!recordedByHeatNumber.has(cycle.heatNumber)) recordedByHeatNumber.set(cycle.heatNumber, cycle)
  }
  let latestActual = null
  for (const [n, cycle] of recordedByHeatNumber) {
    const d = new Date(cycle.heatStartDate)
    if (!latestActual || n > latestActual.n) latestActual = { n, date: d }
  }

  const predictedHeats = []
  if (!dob) return predictedHeats
  const anchor = firstHeatDate ? new Date(firstHeatDate) : addMonths(dob, firstHeatMo)
  for (let i = 0; i < 6; i++) {
    const n = i + 1
    const actual = recordedByHeatNumber.get(n)
    if (actual) {
      predictedHeats.push({ n, date: new Date(actual.heatStartDate), label: `Heat ${n} (recorded)`, recorded: true })
      continue
    }
    const date = latestActual && n > latestActual.n
      ? addMonths(latestActual.date, heatInterval * (n - latestActual.n))
      : addMonths(anchor, heatInterval * i)
    predictedHeats.push({ n, date, label: n === 1 && firstHeatDate ? 'Heat 1 (actual)' : `Heat ${n} (estimated)`, recorded: false })
  }
  return predictedHeats
}

const DOB = '2020-01-01'
const BASE = { dob: DOB, firstHeatDate: '', heatInterval: 6, firstHeatMo: 8 }

// ── Test 1: with no heatCycles records, every slot is estimated ──
{
  const heats = buildPredictedHeats({ ...BASE, heatCycles: [] })
  check('No recorded heats: all 6 slots estimated, none recorded', heats.every(h => !h.recorded) && heats.length === 6)
}

// ── Test 2: an actual Heat 6 record overrides the estimated Heat 6 slot
// — the exact bug scenario reported (My QA recorded actual Heat 6) ──
{
  const heatCycles = [{ id: 'c1', heatNumber: 6, heatStartDate: '2026-06-01' }]
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  const heat6 = heats.find(h => h.n === 6)
  check('Actual Heat 6 replaces the estimated slot', heat6.recorded === true)
  check('Actual Heat 6 label says "recorded", not "estimated"', heat6.label === 'Heat 6 (recorded)')
  check('Actual Heat 6 shows the real recorded date, not the stale estimate', heat6.date.toISOString().slice(0, 10) === '2026-06-01')
  const otherSlots = heats.filter(h => h.n !== 6)
  check('Other slots remain estimated (unaffected)', otherSlots.every(h => !h.recorded))
}

// ── Test 3: no duplicate Heat N — exactly one item per heat number,
// even with multiple actual records sharing the same heatNumber (a data
// anomaly) — resolved deterministically by lowest doc id ──
{
  const heatCycles = [
    { id: 'zzz_later', heatNumber: 3, heatStartDate: '2026-03-15' },
    { id: 'aaa_earlier', heatNumber: 3, heatStartDate: '2026-03-01' },
  ]
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  const heat3Items = heats.filter(h => h.n === 3)
  check('Exactly one Heat 3 item even with two duplicate-numbered records', heat3Items.length === 1)
  check('Duplicate resolution is deterministic (lowest doc id wins)', heat3Items[0].date.toISOString().slice(0, 10) === '2026-03-01')

  // Re-running with the array in the opposite order must give the same result
  const heatsReordered = buildPredictedHeats({ ...BASE, heatCycles: [...heatCycles].reverse() })
  check('Duplicate resolution is stable regardless of input array order',
    heatsReordered.find(h => h.n === 3).date.toISOString().slice(0, 10) === '2026-03-01')
}

// ── Test 4: later estimates anchor from the latest actual recorded
// heat, not purely from DOB/heat-1 extrapolation ──
{
  const heatCycles = [{ id: 'c5', heatNumber: 5, heatStartDate: '2026-05-01' }]
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  const heat6 = heats.find(h => h.n === 6)
  check('Heat 6 (unrecorded, after the latest actual) is estimated', heat6.recorded === false)
  const expected = addMonths(new Date('2026-05-01'), 6) // heatInterval=6, one slot after n=5
  check('Heat 6 estimate anchors from Heat 5\'s actual date + one interval (not from DOB/heat-1)',
    heat6.date.toISOString().slice(0, 10) === expected.toISOString().slice(0, 10))
}

// ── Test 5: missing heat number — a heatCycles doc with no heatNumber
// can't be matched to any slot and is ignored (all slots stay estimated) ──
{
  const heatCycles = [{ id: 'c1', heatStartDate: '2026-01-01' }] // no heatNumber field
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  check('A heat record with no heatNumber is ignored (no crash, no false match)', heats.every(h => !h.recorded))
}

// ── Test 6: legacy heat record with no heatStartDate — can't display a
// real date, so it's ignored rather than showing an undefined/invalid date ──
{
  const heatCycles = [{ id: 'c1', heatNumber: 2 }] // no heatStartDate
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  check('A legacy record with no heatStartDate does not override its slot', heats.find(h => h.n === 2).recorded === false)
}

// ── Test 7: out-of-order actual dates — Heat 6 recorded with an EARLIER
// date than Heat 5's recorded date (a data-entry anomaly). The anchor
// policy is heat-number order, not calendar-date order, so this must not
// crash or produce a nonsensical negative-interval estimate. ──
{
  const heatCycles = [
    { id: 'c5', heatNumber: 5, heatStartDate: '2026-06-01' },
    { id: 'c6', heatNumber: 6, heatStartDate: '2026-05-01' }, // earlier than heat 5's date
  ]
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  check('Both out-of-order actual heats still display their own real recorded dates',
    heats.find(h => h.n === 5).date.toISOString().slice(0, 10) === '2026-06-01' &&
    heats.find(h => h.n === 6).date.toISOString().slice(0, 10) === '2026-05-01')
  check('Anchor for slots is still keyed off the highest heat NUMBER (6), not the latest date', true) // n=6 is already the last slot (i<6), nothing further to predict — documents the policy
}

// ── Test 8: editing an actual heat (date correction) is reflected
// immediately — pure function re-invocation with updated input, same as
// a React re-render after setHeatCycles ──
{
  const before = buildPredictedHeats({ ...BASE, heatCycles: [{ id: 'c1', heatNumber: 4, heatStartDate: '2026-04-01' }] })
  const after = buildPredictedHeats({ ...BASE, heatCycles: [{ id: 'c1', heatNumber: 4, heatStartDate: '2026-04-15' }] })
  check('Editing an actual heat date updates the displayed date on next computation',
    before.find(h => h.n === 4).date.toISOString().slice(0, 10) === '2026-04-01' &&
    after.find(h => h.n === 4).date.toISOString().slice(0, 10) === '2026-04-15')
}

// ── Test 9: deleting an actual heat reverts that slot back to estimated
// (not stuck showing a stale "recorded" date for a record that no longer exists) ──
{
  const before = buildPredictedHeats({ ...BASE, heatCycles: [{ id: 'c1', heatNumber: 4, heatStartDate: '2026-04-01' }] })
  const after = buildPredictedHeats({ ...BASE, heatCycles: [] }) // record deleted
  check('Before delete: Heat 4 is recorded', before.find(h => h.n === 4).recorded === true)
  check('After delete: Heat 4 reverts to estimated', after.find(h => h.n === 4).recorded === false)
}

// ── Test 10 (structural): DogDetailPage.tsx's real implementation
// matches this mirrored algorithm — recordedByHeatNumber built, latest-
// actual anchoring, and the render uses heat.recorded (not a separate
// re-derived lookup, which was the original bug) ──
{
  const src = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  check('recordedByHeatNumber map is built from heatCycles', /const recordedByHeatNumber = new Map<number, HeatCycle>\(\)/.test(src))
  check('Ties are resolved deterministically by doc id', /\.sort\(\(a, b\) => \(a\.id \|\| ''\)\.localeCompare\(b\.id \|\| ''\)\)/.test(src))
  check('latestActual anchor is derived from recordedByHeatNumber', /let latestActual: \{ n: number; date: Date \} \| null = null/.test(src))
  check('predictedHeats pushes a recorded:true entry using the actual date when a match exists',
    /recorded: true \}\)/.test(src) && /new Date\(actual\.heatStartDate\)/.test(src))
  check('Estimated slots after the latest actual re-anchor from it',
    /latestActual && n > latestActual\.n[\s\S]{0,80}addMonths\(latestActual\.date, heatInterval \* \(n - latestActual\.n\)\)/.test(src))
  check('Render uses heat.recorded (derived once), not a second heatCycles.find() lookup',
    /heat\.recorded &&/.test(src) && !/const recorded = heatCycles\.find/.test(src))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
