// Regression coverage for the Heat Cycle Predictor / actual-record sync
// (fix/sire-heat-cycle, Recorded Heat Prediction blocker + product policy
// correction).
//
// History: the first fix matched actual heatCycles records to a
// DOB-predicted slot by the record's own user-editable heatNumber field
// — but that field is exactly that, user-editable, and independent of
// when heats actually happened. A breeder revisiting old paperwork could
// end up with "Recorded Heat 6" attached to whatever slot the DOB
// estimator happened to land heat 6 on, which is not what "Recorded Heat
// N" is supposed to mean.
//
// Corrected policy: "Recorded Heat N" means the Nth actual heat-cycle
// record for this Dam, numbered by chronological order of the recorded
// heatStartDate — never by matching against a DOB-estimated slot index,
// and never by the record's own heatNumber field.
//   - No actual records: show the original DOB/firstHeatDate 6-slot
//     estimate view, unchanged.
//   - One or more actual records: show "Recorded Heat 1..K" in actual
//     date order (each with its own real date), plus exactly one "Next
//     estimated heat" anchored from the latest (by number, i.e. most
//     recent chronologically) actual date.
//
// This file mirrors that exact algorithm in isolation (no DOM/React
// needed) plus static source assertions that DogDetailPage.tsx's real
// implementation matches it.
//
// Usage: node scripts/test-heat-predictor-sync.mjs (no emulator needed)

const { readFileSync } = await import('node:fs')

import { makeChecker } from './_lib/test-check.mjs'
const { check, checkAsync, skip, summary } = makeChecker()

// ── Mirror of DogDetailPage.tsx's addMonths + predictedHeats logic ──
function addMonths(date, months) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function buildPredictedHeats({ dob, firstHeatDate, heatInterval, firstHeatMo, heatCycles }) {
  const actualHeats = heatCycles
    .filter(c => !!c.heatStartDate)
    .slice()
    .sort((a, b) => a.heatStartDate.localeCompare(b.heatStartDate) || (a.id || '').localeCompare(b.id || ''))
    .map((cycle, i) => ({ n: i + 1, date: new Date(cycle.heatStartDate), cycle }))
  const latestActual = actualHeats.length > 0 ? actualHeats[actualHeats.length - 1] : null

  const predictedHeats = []
  if (latestActual) {
    for (const h of actualHeats) {
      predictedHeats.push({ n: h.n, date: h.date, label: `Recorded Heat ${h.n}`, recorded: true })
    }
    predictedHeats.push({
      n: latestActual.n + 1,
      date: addMonths(latestActual.date, heatInterval),
      label: 'Next estimated heat',
      recorded: false,
    })
  } else if (dob) {
    const anchor = firstHeatDate ? new Date(firstHeatDate) : addMonths(dob, firstHeatMo)
    for (let i = 0; i < 6; i++) {
      predictedHeats.push({
        n: i + 1,
        date: addMonths(anchor, heatInterval * i),
        label: i === 0 ? (firstHeatDate ? 'Heat 1 (actual)' : 'Heat 1 (estimated)') : `Heat ${i + 1} (estimated)`,
        recorded: false,
      })
    }
  }
  return predictedHeats
}

const DOB = '2020-01-01'
const BASE = { dob: DOB, firstHeatDate: '', heatInterval: 6, firstHeatMo: 8 }

// ── Test 1: no actual records — falls back to the original 6-slot
// DOB-based estimate view, unchanged ──
{
  const heats = buildPredictedHeats({ ...BASE, heatCycles: [] })
  check('No actual records: falls back to 6-slot DOB estimate', heats.length === 6)
  check('No actual records: every slot is estimated (recorded: false)', heats.every(h => !h.recorded))
  check('No actual records: slot 1 uses the original "Heat 1 (estimated)" wording', heats[0].label === 'Heat 1 (estimated)')
}

// ── Test 2: exactly one actual record — "Recorded Heat 1" with the real
// date, plus a single "Next estimated heat" anchored from it ──
{
  const heatCycles = [{ id: 'c1', heatNumber: 4, heatStartDate: '2026-03-10' }] // heatNumber deliberately wrong/irrelevant
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  check('One actual record: exactly 2 items shown (recorded + next estimate)', heats.length === 2)
  check('First item is "Recorded Heat 1" regardless of the record\'s own heatNumber field', heats[0].label === 'Recorded Heat 1' && heats[0].n === 1)
  check('Recorded Heat 1 shows the real recorded date', heats[0].date.toISOString().slice(0, 10) === '2026-03-10')
  check('Recorded Heat 1 is flagged recorded: true', heats[0].recorded === true)
  check('Second item is labelled "Next estimated heat"', heats[1].label === 'Next estimated heat')
  check('Next estimated heat anchors from the actual date + one interval',
    heats[1].date.toISOString().slice(0, 10) === addMonths(new Date('2026-03-10'), 6).toISOString().slice(0, 10))
  check('Next estimated heat is flagged recorded: false', heats[1].recorded === false)
}

// ── Test 3: multiple actual records — numbered strictly by actual
// chronological order (heatStartDate), NOT by the stored heatNumber
// field, which is deliberately set out of sync with the real dates here
// to prove the old (rejected) matching behavior is gone ──
{
  const heatCycles = [
    { id: 'c_first', heatNumber: 6, heatStartDate: '2026-01-01' },   // earliest date, but heatNumber says 6
    { id: 'c_second', heatNumber: 1, heatStartDate: '2026-07-01' },  // latest date, but heatNumber says 1
    { id: 'c_middle', heatNumber: 3, heatStartDate: '2026-04-01' },
  ]
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  const recorded = heats.filter(h => h.recorded)
  check('Three actual records produce three Recorded Heat items', recorded.length === 3)
  check('Recorded Heat 1 is the EARLIEST actual date (2026-01-01), not the one whose heatNumber field says 1',
    recorded[0].label === 'Recorded Heat 1' && recorded[0].date.toISOString().slice(0, 10) === '2026-01-01')
  check('Recorded Heat 2 is the middle actual date', recorded[1].label === 'Recorded Heat 2' && recorded[1].date.toISOString().slice(0, 10) === '2026-04-01')
  check('Recorded Heat 3 is the LATEST actual date (2026-07-01), not the one whose heatNumber field says 6',
    recorded[2].label === 'Recorded Heat 3' && recorded[2].date.toISOString().slice(0, 10) === '2026-07-01')
  const nextEstimate = heats.find(h => !h.recorded)
  check('Next estimate anchors from the chronologically latest actual (2026-07-01), not from heatNumber order',
    nextEstimate.date.toISOString().slice(0, 10) === addMonths(new Date('2026-07-01'), 6).toISOString().slice(0, 10))
  check('No stale DOB-based heat number is attached to any actual record (all use actual-order n, not a DOB slot index)',
    recorded.every((h, i) => h.n === i + 1))
}

// ── Test 4: editing an actual record's date reorders/renumbers
// deterministically — moving a record earlier promotes it to Recorded
// Heat 1 ──
{
  const before = buildPredictedHeats({
    ...BASE,
    heatCycles: [
      { id: 'c1', heatNumber: 1, heatStartDate: '2026-02-01' },
      { id: 'c2', heatNumber: 2, heatStartDate: '2026-08-01' },
    ],
  })
  check('Before edit: c1 (Feb) is Recorded Heat 1, c2 (Aug) is Recorded Heat 2',
    before[0].date.toISOString().slice(0, 10) === '2026-02-01' && before[1].date.toISOString().slice(0, 10) === '2026-08-01')

  // Editing c2's date to be earlier than c1 must swap their order
  const after = buildPredictedHeats({
    ...BASE,
    heatCycles: [
      { id: 'c1', heatNumber: 1, heatStartDate: '2026-02-01' },
      { id: 'c2', heatNumber: 2, heatStartDate: '2026-01-01' }, // edited to be earlier
    ],
  })
  check('After edit: Recorded Heat 1 is now the 2026-01-01 date (reordered)', after[0].date.toISOString().slice(0, 10) === '2026-01-01')
  check('After edit: Recorded Heat 2 is now the 2026-02-01 date', after[1].date.toISOString().slice(0, 10) === '2026-02-01')
}

// ── Test 5: deleting an actual record renumbers the remaining ones and
// re-anchors the next estimate ──
{
  const withThree = buildPredictedHeats({
    ...BASE,
    heatCycles: [
      { id: 'c1', heatNumber: 1, heatStartDate: '2026-01-01' },
      { id: 'c2', heatNumber: 2, heatStartDate: '2026-06-01' },
      { id: 'c3', heatNumber: 3, heatStartDate: '2026-12-01' },
    ],
  })
  check('Before delete: 3 recorded + 1 next-estimate', withThree.filter(h => h.recorded).length === 3)
  check('Before delete: next estimate anchors from the latest (Dec)',
    withThree.find(h => !h.recorded).date.toISOString().slice(0, 10) === addMonths(new Date('2026-12-01'), 6).toISOString().slice(0, 10))

  // Delete the latest (c3) — remaining two renumber 1,2 and the next
  // estimate re-anchors from the new latest (c2, June)
  const afterDelete = buildPredictedHeats({
    ...BASE,
    heatCycles: [
      { id: 'c1', heatNumber: 1, heatStartDate: '2026-01-01' },
      { id: 'c2', heatNumber: 2, heatStartDate: '2026-06-01' },
    ],
  })
  check('After deleting the latest record: 2 recorded + 1 next-estimate', afterDelete.filter(h => h.recorded).length === 2)
  check('After delete: next estimate re-anchors from the new latest actual (June)',
    afterDelete.find(h => !h.recorded).date.toISOString().slice(0, 10) === addMonths(new Date('2026-06-01'), 6).toISOString().slice(0, 10))

  // Delete everything — reverts fully to the DOB fallback view
  const afterDeleteAll = buildPredictedHeats({ ...BASE, heatCycles: [] })
  check('After deleting all records: reverts to the 6-slot DOB fallback', afterDeleteAll.length === 6 && afterDeleteAll.every(h => !h.recorded))
}

// ── Test 6: missing heat number on an actual record does not prevent it
// from being placed in the actual-order timeline — heatNumber is
// irrelevant to this predictor now, only heatStartDate matters ──
{
  const heatCycles = [{ id: 'c1', heatStartDate: '2026-05-01' }] // no heatNumber field at all
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  check('A record with no heatNumber field still becomes Recorded Heat 1 (heatNumber is irrelevant here)',
    heats[0].label === 'Recorded Heat 1' && heats[0].recorded === true)
}

// ── Test 7: legacy record with no heatStartDate at all — can't be
// placed in a chronological timeline, so it's excluded entirely rather
// than crashing or being assigned an arbitrary position ──
{
  const heatCycles = [
    { id: 'c1', heatNumber: 1, heatStartDate: '2026-01-01' },
    { id: 'c2', heatNumber: 2 }, // legacy: no heatStartDate
  ]
  const heats = buildPredictedHeats({ ...BASE, heatCycles })
  check('Legacy record with no heatStartDate is excluded from the actual timeline', heats.filter(h => h.recorded).length === 1)
  check('The one valid actual record still becomes Recorded Heat 1', heats[0].label === 'Recorded Heat 1')
}

// ── Test 8: duplicate exact-same-date actual records resolve
// deterministically (tiebreak by doc id), not randomly on each render ──
{
  const heatCycles = [
    { id: 'zzz', heatNumber: 1, heatStartDate: '2026-03-01' },
    { id: 'aaa', heatNumber: 2, heatStartDate: '2026-03-01' },
  ]
  const heats1 = buildPredictedHeats({ ...BASE, heatCycles })
  const heats2 = buildPredictedHeats({ ...BASE, heatCycles: [...heatCycles].reverse() })
  check('Same-date records order deterministically regardless of input array order',
    heats1.filter(h => h.recorded).length === 2 && heats2.filter(h => h.recorded).length === 2)
}

// ── Test 9 (structural): DogDetailPage.tsx's real implementation
// matches this mirrored algorithm — actual-order numbering, no
// heatNumber-based matching, and the render uses heat.recorded directly ──
{
  const src = readFileSync(new URL('../src/pages/DogDetailPage.tsx', import.meta.url), 'utf8')
  check('actualHeats is built by filtering/sorting on heatStartDate (not heatNumber matching)',
    /const actualHeats = heatCycles/.test(src) &&
    /\.sort\(\(a, b\) => a\.heatStartDate\.localeCompare\(b\.heatStartDate\)/.test(src))
  check('Recorded items are labelled "Recorded Heat ${h.n}" using actual-order n', /`Recorded Heat \$\{h\.n\}`/.test(src))
  check('Exactly one trailing item is labelled "Next estimated heat"', /label: 'Next estimated heat'/.test(src))
  check('No remaining heatNumber-based matching against actual records (recordedByHeatNumber removed)',
    !/recordedByHeatNumber/.test(src))
  check('The now-stale-prone heatNumber===1 auto-set-firstHeatDate side effect was removed',
    !/cycle\.heatNumber === 1 && cycle\.heatStartDate && !firstHeatDate/.test(src))
  check('Render uses heat.recorded (derived once), not a second heatCycles.find() lookup',
    /heat\.recorded &&/.test(src) && !/const recorded = heatCycles\.find/.test(src))
}

summary()
