const clean = (v, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : ''
const day = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null
}
const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null

export function validateFacility(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid facility')
  const caps = ['breedingFemale', 'breedingMale', 'boarding'].map(k => input[k] === '' || input[k] == null ? null : Number(input[k]))
  if (caps.some(n => n !== null && (!Number.isInteger(n) || n < 0 || n > 1000))) throw new Error('Invalid approval limit')
  const ledgerStartDate = day(input.ledgerStartDate)
  if (input.ledgerStartDate && !ledgerStartDate) throw new Error('Invalid ledger start date')
  return {
    facilityName: clean(input.facilityName), address: clean(input.address, 300),
    approvalNumber: clean(input.approvalNumber), approvalDocumentRef: clean(input.approvalDocumentRef, 300),
    council: clean(input.council), ledgerStartDate,
    breedingFemale: caps[0], breedingMale: caps[1], boarding: caps[2],
    conditionNotes: clean(input.conditionNotes, 2000),
    ledgerAttested: input.ledgerAttested === true,
  }
}

export function validateMovement(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid movement')
  const occurredAt = timestamp(input.occurredAt)
  if (!occurredAt || !['arrival', 'departure'].includes(input.direction) ||
    !['breeding', 'boarding', 'puppy', 'other'].includes(input.category) ||
    !/^[a-zA-Z0-9_-]{1,150}$/.test(input.dogId || '')) throw new Error('Invalid movement fields')
  return { dogId: input.dogId, occurredAt, direction: input.direction,
    category: input.category, note: clean(input.note, 500) }
}

export function validateDailyLog(input) {
  if (!input || typeof input !== 'object' || !day(input.date)) throw new Error('Invalid log date')
  const exerciseMinutes = input.exerciseMinutes === '' || input.exerciseMinutes == null ? null : Number(input.exerciseMinutes)
  if (exerciseMinutes !== null && (!Number.isInteger(exerciseMinutes) || exerciseMinutes < 0 || exerciseMinutes > 1440)) throw new Error('Invalid exercise minutes')
  return { date: input.date, exerciseMinutes, caretaker: clean(input.caretaker),
    careNotes: clean(input.careNotes, 1000), incidentNotes: clean(input.incidentNotes, 1000) }
}
