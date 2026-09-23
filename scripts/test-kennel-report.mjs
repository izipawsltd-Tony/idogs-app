import assert from 'node:assert/strict'
import { buildKennelReport, kennelCSV, kennelHTML } from '../api/_lib/kennel-report.js'

const dogs = [
  { id: 'one', name: 'Red Boy', dateOfBirth: '2026-07-16', microchip: '123', status: 'active', vaccines: [{ id: 'v1', name: '<script>', dateGiven: '2025-09-01' }] },
  { id: 'two', name: 'Red Boy', dateOfBirth: '2026-07-21', microchip: '123', status: 'transferred', wormings: [{ id: 'w1', product: '=SUM(1)', dateGiven: '2026-08-01', nextDue: '2006-08-14' }] },
]
const report = buildKennelReport({ dogs, litters: [{ id: 'l1', name: 'Litter', damId: 'one', puppyIds: ['two', 'missing'] }] }, {}, new Date('2026-09-23T00:00:00Z'))
assert.equal(report.dogs.length, 2)
assert(report.issues.some(i => i.message.includes('Microchip 123')))
assert(report.issues.some(i => i.message.includes('precedes dog')))
assert(report.issues.some(i => i.message.includes('Next due date')))
assert(report.issues.some(i => i.message.includes('Puppy missing')))
assert.match(kennelCSV(report), /"one","one"/)
assert.match(kennelCSV(report), /"'=SUM\(1\)"/)
const html = kennelHTML(report)
assert.match(html, /&lt;script&gt;/)
assert.doesNotMatch(html, /<script>/)
assert.match(html, /DRAFT — DATA REQUIRES REVIEW/)
assert.match(html, /historical occupancy is unavailable/)
console.log('Kennel report validation passed')
