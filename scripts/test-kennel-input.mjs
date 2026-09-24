import assert from 'node:assert/strict'
import { validateFacility, validateMovement, validateDailyLog } from '../api/_lib/kennel-input.js'
assert.equal(validateFacility({ breedingFemale:'12', breedingMale:'2', boarding:'10', ledgerAttested:true }).breedingFemale,12)
assert.throws(()=>validateFacility({ breedingFemale:'12.5' }))
assert.throws(()=>validateFacility({ ledgerStartDate:'2026-02-30' }))
assert.throws(()=>validateMovement({ dogId:'a/b', direction:'arrival', category:'breeding', occurredAt:'2026-09-23' }))
assert.equal(validateMovement({ dogId:'dog1', direction:'departure', category:'boarding', occurredAt:'2026-09-23T10:00:00+09:30' }).dogId,'dog1')
assert.throws(()=>validateDailyLog({ date:'2026-09-23', exerciseMinutes:-1 }))
console.log('Kennel input validation passed')
