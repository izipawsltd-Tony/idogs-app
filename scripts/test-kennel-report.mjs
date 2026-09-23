import assert from 'node:assert/strict'
import { buildKennelReport, kennelCSV, kennelHTML, issueLabel, validatePeriod } from '../api/_lib/kennel-report.js'
import { kennelWorkbook } from '../api/_lib/kennel-workbook.js'
assert.throws(()=>validatePeriod('2026-02-30','2026-03-01'))

const dogs = [
  { id: 'one', name: 'Red Boy', dateOfBirth: '2026-07-16', microchip: '123', status: 'active', vaccines: [{ id: 'v1', name: '<script>', dateGiven: '2025-09-01' }] },
  { id: 'two', name: 'Red Boy', dateOfBirth: '2026-07-21', microchip: '123', status: 'transferred', wormings: [{ id: 'w1', product: '=SUM(1)', dateGiven: '2026-08-01', nextDue: '2006-08-14' }] },
]
const report = buildKennelReport({ dogs, litters: [{ id: 'l1', name: 'Litter', damId: 'one', puppyIds: ['two', 'missing'] }] }, {}, new Date('2026-09-23T00:00:00Z'))
assert.equal(report.dogs.length, 2)
assert(report.issues.some(i => i.message.includes('Microchip 123')))
assert(report.issues.some(i => i.message.includes('precedes Red Boy')))
assert(report.issues.some(i => i.message.includes('Next due date')))
assert.equal(issueLabel(report, report.issues.find(i => i.id === 'v1')), 'Red Boy')
assert(report.issues.some(i => i.message.includes('Puppy missing')))
assert.match(kennelCSV(report), /"one","one"/)
assert.match(kennelCSV(report), /"'=SUM\(1\)"/)
const html = kennelHTML(report)
assert.match(html, /&lt;script&gt;/)
assert.doesNotMatch(html, /<script>/)
assert.match(html, /DRAFT — DATA REQUIRES REVIEW/)
assert.match(html, /Opening roster and complete movement history/)
assert.equal(report.daily[0].breedingFemale, null)
assert.match(html, /Not verifiable: the opening roster/)
const workbook = kennelWorkbook(report)
assert.equal(workbook.readUInt32LE(0), 0x04034b50)
assert(workbook.includes(Buffer.from('xl/worksheets/sheet9.xml')))
const occupied = buildKennelReport({ dogs: [{ id:'dam', name:'Dam', sex:'female', dateOfBirth:'2020-01-01', microchip:'987' }], litters: [],
  facility: { address:'1 Road', approvalNumber:'DA1', approvalDocumentRef:'document 1', ledgerStartDate:'2026-09-01', ledgerAttested:true, breedingFemale:0, conditionNotes:'Care condition' },
  movements: [{ id:'a', dogId:'dam', direction:'arrival', category:'breeding', occurredAt:'2026-09-23T00:00:00Z' }], dailyLogs: [] },
  { kennelName:'Kennel', breederIdValue:'DACO1' }, new Date('2026-09-24T00:00:00Z'), { from:'2026-09-23', to:'2026-09-23' })
assert.equal(occupied.daily[0].breedingFemale, 1)
assert(occupied.issues.some(i=>i.message.includes('exceeds configured limit')))
assert(occupied.issues.some(i=>i.message.includes('Care/caretaker log')))
const ready = buildKennelReport({ dogs: [{ id:'dam', name:'Dam', sex:'female', dateOfBirth:'2020-01-01', microchip:'987' }], litters: [],
  facility: { address:'1 Road', approvalNumber:'DA1', approvalDocumentRef:'document 1', ledgerStartDate:'2026-09-01', ledgerAttested:true, breedingFemale:1, conditionNotes:'Care condition' },
  movements: [{ id:'a', dogId:'dam', direction:'arrival', category:'breeding', occurredAt:'2026-09-23T00:00:00Z' }],
  dailyLogs: [{ date:'2026-09-23', caretaker:'Owner', exerciseMinutes:45 }] },
  { kennelName:'Kennel', breederIdValue:'DACO1' }, new Date('2026-09-24T00:00:00Z'), { from:'2026-09-23', to:'2026-09-23' })
assert.equal(ready.status, 'READY FOR OWNER REVIEW')
const contaminated = buildKennelReport({ dogs: [{ id:'qa', name:'QA-test-dog', dateOfBirth:'0026-05-09', microchip:'555' }], litters:[] }, {}, new Date('2026-09-23T00:00:00Z'))
assert(contaminated.issues.some(i => i.message.includes('Possible test record')))
assert(contaminated.issues.some(i => i.message.includes('Date of birth missing or invalid')))
assert(kennelWorkbook(contaminated).includes(Buffer.from('xl/worksheets/sheet9.xml')))
console.log('Kennel report validation passed')
