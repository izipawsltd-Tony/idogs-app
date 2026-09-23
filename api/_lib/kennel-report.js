// Read-only presentation model for kennel exports. It never infers on-site
// occupancy or council approval from a dog's account status.
const value = (v) => v == null || v === '' ? 'Not recorded' : String(v)
export const escapeHTML = (v) => value(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const isoDay = (v) => {
  if (!v) return null
  const d = new Date(v)
  if (!Number.isFinite(d.getTime())) return null
  const day = d.toISOString().slice(0, 10)
  return Number(day.slice(0, 4)) >= 1900 ? day : null
}
const csvCell = v => `"${String(v == null ? '' : v).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`
const localDay = v => {
  const date = new Date(v)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Adelaide', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
const daysBetween = (from, to) => {
  const out = []
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86400000) out.push(new Date(ms).toISOString().slice(0, 10))
  return out
}

export function validatePeriod(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') ||
    isoDay(`${from}T00:00:00Z`) !== from || isoDay(`${to}T00:00:00Z`) !== to ||
    from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 366) {
    throw new Error('Select a valid reporting period of up to 366 days')
  }
  return { from, to }
}

function occupancyForPeriod(dogs, movements, facility, from, to, add) {
  const byId = new Map(dogs.map(d => [d.id, d]))
  const active = new Map()
  const daily = []
  const events = movements.filter(m => !m.voidedAt).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
  const verifiable = Boolean(facility?.ledgerStartDate && facility.ledgerStartDate <= from && facility.ledgerAttested && events.length)
  if (!facility?.ledgerStartDate || facility.ledgerStartDate > from || !facility.ledgerAttested) {
    add('Facility', 'ledger', 'Opening roster and complete movement history have not been attested for this period')
  }
  if (!events.length) add('Facility', 'ledger', 'No arrival/departure events recorded; occupancy cannot be established')
  const counts = () => {
    const c = { breedingFemale: 0, breedingMale: 0, boarding: 0, puppies: 0, other: 0 }
    for (const [id, category] of active) {
      if (category === 'breeding') c[byId.get(id)?.sex === 'female' ? 'breedingFemale' : 'breedingMale']++
      else if (category === 'boarding') c.boarding++
      else if (category === 'puppy') c.puppies++
      else c.other++
    }
    return c
  }
  const apply = m => {
    if (!byId.has(m.dogId)) { add('Movement', m.id, `Dog ${m.dogId} is missing from report`); return }
    if (m.category === 'breeding' && !['female', 'male'].includes(byId.get(m.dogId)?.sex)) add('Movement', m.id, `Breeding dog ${m.dogId} has no valid sex recorded`)
    if (m.direction === 'arrival') {
      if (active.has(m.dogId)) add('Movement', m.id, `Dog ${m.dogId} has two arrivals without a departure`)
      else active.set(m.dogId, m.category)
    } else if (!active.has(m.dogId)) add('Movement', m.id, `Dog ${m.dogId} departs without a recorded arrival`)
    else {
      if (active.get(m.dogId) !== m.category) add('Movement', m.id, `Departure category does not match arrival for dog ${m.dogId}`)
      active.delete(m.dogId)
    }
  }
  let cursor = 0
  for (const date of daysBetween(from, to)) {
    while (cursor < events.length && localDay(events[cursor].occurredAt) < date) apply(events[cursor++])
    const peak = { ...counts() }
    while (cursor < events.length && localDay(events[cursor].occurredAt) === date) {
      apply(events[cursor++]); const current = counts()
      for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], current[key])
    }
    const closing = counts()
    daily.push({ date, ...(verifiable ? closing : Object.fromEntries(Object.keys(closing).map(k => [k, null]))), peak: verifiable ? peak : null, verifiable })
    if (!verifiable) continue
    for (const key of ['breedingFemale', 'breedingMale', 'boarding']) {
      if (facility?.[key] != null && peak[key] > facility[key]) add('Occupancy', date, `${key} peak ${peak[key]} exceeds configured limit ${facility[key]}`)
    }
  }
  return daily
}

export function buildKennelReport(data, profile = {}, generatedAt = new Date(), period = null) {
  profile = profile || {}
  const dogs = data.dogs || []
  const litters = data.litters || []
  const byId = new Map(dogs.map(d => [d.id, d]))
  const heatCycles = (data.heatCycles || []).filter(c => byId.has(c.dogId)).sort((a,b) => String(b.heatStartDate || b.matingDate || '').localeCompare(String(a.heatStartDate || a.matingDate || '')))
  const puppies = litters.flatMap(litter => (litter.puppyIds || []).map(id => ({ litter, dog: byId.get(id), id })))
  const issues = []
  const add = (subject, id, message) => issues.push({ subject, id, message })
  const facility = data.facility || null
  const selected = validatePeriod(period?.from || localDay(generatedAt), period?.to || localDay(generatedAt))
  const movements = (data.movements || []).filter(m => localDay(m.occurredAt) && localDay(m.occurredAt) <= selected.to)
  const dailyLogs = (data.dailyLogs || []).filter(l => l.date >= selected.from && l.date <= selected.to)
  if (!facility?.address || !facility?.approvalNumber || !facility?.approvalDocumentRef) add('Facility', 'approval', 'Address, approval number or approval document reference not recorded')
  const daily = occupancyForPeriod(dogs, movements, facility, selected.from, selected.to, add)
  const logDays = new Set(dailyLogs.map(l => l.date))
  for (const item of daily) if (item.verifiable && item.breedingFemale + item.breedingMale + item.boarding + item.puppies + item.other > 0 && !logDays.has(item.date)) add('Daily care', item.date, 'Care/caretaker log not recorded for occupied day')
  const chips = new Map()
  for (const dog of dogs) {
    if (/(?:^|[\s_-])(?:qa|test)(?:$|[\s_-])/i.test(dog.name || '')) add('Dog', dog.id, 'Possible test record; confirm whether this dog belongs in a Council report')
    const chip = String(dog.microchip || '').trim()
    if (dog.depositAmount != null && (!Number.isFinite(Number(dog.depositAmount)) || Number(dog.depositAmount) < 0)) add('Sale', dog.id, `Deposit amount for ${dog.name || 'this dog'} is invalid; reconcile the source`)
    if (!chip) add('Dog', dog.id, 'Microchip not recorded; confirm age, sale status or exemption')
    else {
      if (chips.has(chip) && chips.get(chip) !== dog.id) add('Dog', dog.id, `Microchip ${chip} also appears on ${byId.get(chips.get(chip))?.name || 'another dog'}; reconcile source records`)
      chips.set(chip, dog.id)
    }
    const dob = isoDay(dog.dateOfBirth)
    if (!dob) add('Dog', dog.id, 'Date of birth missing or invalid')
    else if (dob > localDay(generatedAt)) add('Dog', dog.id, 'Date of birth is in the future; confirm whether this is a planned puppy record')
    for (const [kind, records, dateKey] of [
      ['Vaccination', dog.vaccines, 'dateGiven'], ['Worming', dog.wormings, 'dateGiven'],
      ['Health test', dog.healthTests, 'dateTested'],
    ]) for (const record of records || []) {
      const day = isoDay(record[dateKey])
      if (!day) add(kind, record.id, `Event date missing or invalid for ${dog.name || 'this dog'}`)
      else if (dob && day < dob) add(kind, record.id, `Event ${day} precedes ${dog.name || 'dog'} birth ${dob}`)
      if (record.nextDue && isoDay(record.nextDue) && day && isoDay(record.nextDue) < day) {
        add(kind, record.id, `Next due date precedes event date for ${dog.name || 'this dog'}`)
      }
      if (record.nextDue && !isoDay(record.nextDue)) add(kind, record.id, `Next due date missing or invalid for ${dog.name || 'this dog'}`)
      if (record.uncertain) add(kind, record.id, `Record marked uncertain for ${dog.name || 'this dog'}; confirm against the source`)
    }
  }
  const linkedPuppies = new Map()
  for (const litter of litters) {
    if (!litter.actualBirthDate) add('Litter', litter.id, 'Actual birth date not recorded; may be planned or incomplete')
    for (const id of litter.puppyIds || []) {
      if (!byId.has(id)) add('Litter', litter.id, `Puppy ${id} is not in this kennel export`)
      if (linkedPuppies.has(id)) add('Litter', litter.id, `Puppy ${byId.get(id)?.name || id} is linked to more than one litter`)
      linkedPuppies.set(id,litter.id)
      if (byId.get(id)?.litterId && byId.get(id).litterId !== litter.id) add('Litter', litter.id, `Puppy ${byId.get(id)?.name || id} points to a different litter`)
    }
    if (litter.damId && !byId.has(litter.damId)) add('Litter', litter.id, `Dam ${litter.damId} is not in this kennel export`)
  }
  for (const cycle of heatCycles) {
    for (const key of ['heatStartDate','matingDate','ultrasoundDate','whelpingActual']) {
      if (cycle[key] && !isoDay(cycle[key])) add('Breeding', cycle.id, `${key} is invalid for ${byId.get(cycle.dogId)?.name || 'the dam'}`)
    }
  }
  if (!profile.kennelName) add('Profile', 'kennel', 'Kennel name not recorded')
  if (!profile.breederIdValue && !profile.breederNumber) add('Profile', 'breeder', 'Breeder registration number not recorded')
  if (!facility?.conditionNotes) add('Facility', 'conditions', 'Approval conditions have not been entered for owner review')
  return { dogs, litters, heatCycles, puppies, byId, issues, profile, facility, movements, dailyLogs, daily, period: selected, generatedAt: generatedAt.toISOString(),
    status: issues.length ? 'DRAFT — DATA REQUIRES REVIEW' : 'READY FOR OWNER REVIEW' }
}

export function kennelCSV(report) {
  // A single typed long table remains usable in Excel without a new dependency.
  const headers = ['Record Type', 'Record ID', 'Dog ID', 'Litter ID', 'Name / Product', 'Breed / Result', 'Sex', 'Date of birth / Event', 'Next due', 'Microchip', 'Registration', 'Vet / Lab', 'Status / Note']
  const rows = [headers]
  const f = report.facility || {}
  rows.push(['FACILITY', '', '', '', f.facilityName, f.address, '', report.period.from, report.period.to, '', f.approvalNumber, f.approvalDocumentRef, `Council: ${value(f.council)}; limits F/M/boarding: ${value(f.breedingFemale)}/${value(f.breedingMale)}/${value(f.boarding)}; conditions: ${value(f.conditionNotes)}`])
  for (const d of report.dogs) {
    rows.push(['DOG', d.id, d.id, d.litterId, d.name, d.breed, d.sex, d.dateOfBirth, '', d.microchip, d.ankc, '', d.status])
    if (d.transferredAt || d.status === 'transferred') rows.push(['TRANSFER', d.id, d.id, d.litterId, d.buyerName, '', '', d.transferredAt, '', d.microchip, '', '', d.transferStatus || 'Transfer recorded; DACO confirmation not verified'])
    for (const v of d.vaccines || []) rows.push(['VACCINE', v.id, d.id, d.litterId, v.name, '', '', v.dateGiven, v.nextDue, '', '', v.vetClinic, v.uncertain ? 'Uncertain' : 'Recorded'])
    for (const w of d.wormings || []) rows.push(['WORMING', w.id, d.id, d.litterId, w.product, '', '', w.dateGiven, w.nextDue, '', '', '', 'Recorded'])
    for (const h of d.healthTests || []) rows.push(['HEALTH_TEST', h.id, d.id, d.litterId, h.testType, h.result, '', h.dateTested, '', '', h.certNumber, h.lab, 'Recorded'])
  }
  for (const l of report.litters) rows.push(['LITTER', l.id, l.damId, l.id, l.name, `Sire: ${value(l.sireName || l.sireId)}; puppies: ${(l.puppyIds || []).length}`, '', l.actualBirthDate, l.expectedDueDate, '', '', '', l.archived ? 'Archived' : 'Recorded'])
  for (const m of report.movements) rows.push(['MOVEMENT', m.id, m.dogId, '', m.direction, m.category, '', m.occurredAt, '', '', '', '', m.voidedAt ? `Voided: ${value(m.voidReason)}` : m.note])
  for (const d of report.daily) rows.push(['DAILY_OCCUPANCY', d.date, '', '', d.verifiable ? `Female ${d.breedingFemale}; male ${d.breedingMale}; boarding ${d.boarding}` : 'Not verifiable', d.verifiable ? `Puppies ${d.puppies}; other ${d.other}` : 'Opening roster or movement history missing', '', d.date, '', '', '', '', d.peak ? `Peak: F ${d.peak.breedingFemale}; M ${d.peak.breedingMale}; boarding ${d.peak.boarding}` : 'Not verifiable'])
  for (const l of report.dailyLogs) rows.push(['DAILY_CARE', l.id || l.date, '', '', `Caretaker: ${value(l.caretaker)}`, `Exercise minutes: ${value(l.exerciseMinutes)}`, '', l.date, '', '', '', '', `${value(l.careNotes)}; incidents: ${value(l.incidentNotes)}`])
  for (const issue of report.issues) rows.push(['ISSUE', issue.id, '', '', issue.subject, '', '', '', '', '', '', '', issue.message])
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}

export function issueLabel(report, issue) {
  const dog = report.byId.get(issue.id)
  if (dog) return dog.name || 'Unnamed dog'
  const litter = report.litters.find(l => l.id === issue.id)
  if (litter) return litter.name || 'Unnamed litter'
  const cycle = report.heatCycles.find(c => c.id === issue.id)
  if (cycle) return report.byId.get(cycle.dogId)?.name || 'Unlinked dam'
  for (const d of report.dogs) if ([...(d.vaccines || []), ...(d.wormings || []), ...(d.healthTests || [])].some(x => x.id === issue.id)) return d.name || 'Unnamed dog'
  if (issue.id === 'approval') return 'Facility approval'
  if (issue.id === 'ledger') return 'Movement ledger'
  if (issue.id === 'conditions') return 'Approval conditions'
  if (issue.id === 'kennel' || issue.id === 'breeder') return 'Breeder profile'
  return issue.id
}

export function kennelHTML(report) {
  const e = escapeHTML
  const p = report.profile
  const row = cells => `<tr>${cells.map(c => `<td>${e(c)}</td>`).join('')}</tr>`
  const table = (heads, rows) => `<table><thead><tr>${heads.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
  const name = id => report.byId.get(id)?.name || (id ? 'Unlinked dog' : 'Not recorded')
  const dogRows = report.dogs.map(d => row([d.name, d.breed, d.sex, d.dateOfBirth, d.microchip, d.status]))
  const litterRows = report.litters.map(l => row([l.name, name(l.damId), l.sireName || name(l.sireId), l.actualBirthDate, (l.puppyIds || []).map(name).join('; ')]))
  const healthRows = report.dogs.flatMap(d => [
    ...(d.vaccines || []).map(v => row([d.name, 'Vaccination', v.name, v.dateGiven, v.nextDue, v.vetClinic, v.uncertain ? 'Uncertain' : 'Recorded'])),
    ...(d.wormings || []).map(w => row([d.name, 'Worming', w.product, w.dateGiven, w.nextDue, '', 'Recorded'])),
    ...(d.healthTests || []).map(h => row([d.name, 'Health test', `${value(h.testType)}: ${value(h.result)}`, h.dateTested, '', h.lab, h.certNumber])),
  ])
  const transfers = report.dogs.filter(d => d.transferredAt || d.status === 'transferred')
  const breedingRows = report.heatCycles.map(c => row([name(c.dogId),c.sireName || name(c.sireId),c.heatStartDate,c.matingDate,c.pregnancyConfirmed?'Yes':'No',c.whelpingEstimate,c.whelpingActual,c.puppiesBorn,c.puppiesAlive]))
  const puppyRows = report.litters.flatMap(l => (l.puppyIds?.length ? l.puppyIds : [null]).map(id => { const d=report.byId.get(id); return row([l.name,name(l.damId),d?.name || (id?'Unlinked puppy':'No puppy records'),d?.sex,d?.availabilityStatus,d?.microchip,d?.buyerName]) }))
  const salesRows = report.dogs.filter(d => d.availabilityStatus === 'sold' || d.availabilityStatus === 'reserved' || d.depositStatus === 'received').map(d=>row([d.name,d.availabilityStatus,d.depositStatus,d.depositAmount,d.buyerName || d.reservedForName]))
  const f = report.facility || {}
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kennel records — ${e(p.kennelName)}</title><style>
  @page{size:A4 landscape;margin:16mm 14mm 18mm;@bottom-left{content:"iDogs · Council review report";font:9pt Arial;color:#53655a}@bottom-right{content:"Page " counter(page);font:9pt Arial;color:#53655a}}
  *{box-sizing:border-box}body{font:10pt/1.42 Arial,Helvetica,sans-serif;color:#203129;margin:0}h1,h2{color:#1A3A2A}h1{font-size:18pt;line-height:1.2;margin:8px 0 4px}h2{font-size:13pt;margin:22px 0 7px;break-after:avoid}p{margin:8px 0;line-height:1.45}.report-head{border-top:8px solid #1A3A2A;border-bottom:1px solid #cbd9cf;padding:12px 0 14px;break-inside:avoid}.brand{color:#1A3A2A;font-size:10pt;font-weight:bold;letter-spacing:.09em}.subtitle{color:#53655a}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:14px}.meta div{background:#e8f1eb;padding:8px 10px;min-width:0;overflow-wrap:anywhere}.meta strong{display:block;color:#1A3A2A;font-size:9pt}.banner{padding:10px 12px;background:#fff4d6;border-left:4px solid #b77900;break-inside:avoid}.details{padding:8px 0;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:8px 0 17px;table-layout:fixed;font-size:9pt}th,td{border:1px solid #d6ded8;padding:6px;overflow-wrap:anywhere;text-align:left;vertical-align:top}th{background:#1A3A2A;color:#fff;font-weight:bold}tbody tr:nth-child(even){background:#f4f6f3}tr{break-inside:avoid}small{color:#53655a}thead{display:table-header-group}tfoot{display:table-footer-group}@media screen{body{max-width:1200px;margin:20px auto;padding:0 20px}}
  </style></head><body><header class="report-head"><div class="brand">iDogs / COUNCIL REVIEW</div><h1>Kennel records report</h1><div class="subtitle">Facility records and evidence summary · Australia/Adelaide</div><div class="meta"><div><strong>Facility</strong>${e(f.facilityName || p.kennelName || 'Not recorded')}</div><div><strong>Reporting period</strong>${e(report.period.from)} to ${e(report.period.to)}</div><div><strong>Report status</strong>${e(report.status)}</div></div></header>
  <p class="banner"><strong>Owner review required</strong><br>Review the issues below and source records before sharing. This report does not certify Council approval or on-site occupancy.</p>
  <div class="details"><strong>Address:</strong> ${e(f.address)} &nbsp; <strong>Council:</strong> ${e(f.council)} &nbsp; <strong>Approval:</strong> ${e(f.approvalNumber)} &nbsp; <strong>Approval document:</strong> ${e(f.approvalDocumentRef)}<br>
  <strong>Conditions:</strong> ${e(f.conditionNotes)}<br><strong>Breeder:</strong> ${e(`${p.firstName || ''} ${p.lastName || ''}`.trim())} &nbsp; <strong>State:</strong> ${e(p.state)} &nbsp; <strong>Breeder ID:</strong> ${e(p.breederIdValue || p.breederNumber)} &nbsp; <strong>Generated:</strong> ${e(report.generatedAt)}</div>
  <h2>Summary</h2><p>${report.dogs.length} dog records · ${report.litters.length} litter records · ${new Set(report.puppies.filter(x=>x.dog).map(x=>x.id)).size} linked puppies · ${report.heatCycles.length} breeding events · ${report.issues.length} review items. “Active” is an account status and does not establish physical presence or compliance with a facility cap.</p>
  <p>Configured limits (owner supplied): breeding female ${e(f.breedingFemale)}, breeding male ${e(f.breedingMale)}, boarding ${e(f.boarding)}. Ledger declared complete from ${e(f.ledgerStartDate)}: ${f.ledgerAttested ? 'Yes' : 'No'}. These entries are not independently verified against the approval document.</p>
  <h2>Review items</h2>${table(['Area','Subject','Action required'],report.issues.map(i=>row([i.subject,issueLabel(report,i),i.message])))}
  <h2>Daily occupancy</h2><p>${report.daily.every(d=>d.verifiable) ? 'Based on the owner-attested movement ledger; reconcile with source records.' : 'Not verifiable: the opening roster or complete movement history is missing. Blank counts must not be interpreted as zero.'}</p>${table(['Date','Evidence','Breeding F','Breeding M','Boarding','Puppies','Other','Peak F / M / boarding'],report.daily.map(d=>row([d.date,d.verifiable?'Owner-attested ledger':'Not verifiable',d.breedingFemale,d.breedingMale,d.boarding,d.puppies,d.other,d.peak?`${d.peak.breedingFemale} / ${d.peak.breedingMale} / ${d.peak.boarding}`:'Not verifiable'])))}
  <h2>Arrival and departure ledger</h2>${table(['Time','Dog','Action','Category','Notes'],report.movements.map(m=>row([m.occurredAt,name(m.dogId),m.direction,m.category,m.voidedAt ? `VOIDED: ${value(m.voidReason)}` : m.note])))}
  <h2>Daily care and incidents</h2>${table(['Date','Caretaker','Exercise minutes','Care notes','Incidents'],report.dailyLogs.map(l=>row([l.date,l.caretaker,l.exerciseMinutes,l.careNotes,l.incidentNotes])))}
  <h2>Dog register</h2>${table(['Name','Breed','Sex','DOB','Microchip','Status'],dogRows)}
  <h2>Breeding register</h2>${breedingRows.length?table(['Dam','Sire','Heat start','Mating','Pregnancy confirmed','Expected whelping','Actual whelping','Born','Alive'],breedingRows):'<p>No breeding events recorded.</p>'}
  <h2>Litters and puppies</h2>${table(['Litter','Dam','Sire','Birth date','Linked puppies'],litterRows)}
  ${table(['Litter','Dam','Puppy','Sex','Availability','Microchip','Recipient'],puppyRows)}
  <h2>Sales records</h2>${salesRows.length?table(['Dog / puppy','Availability','Deposit status','Deposit amount (AUD)','Buyer'],salesRows):'<p>No sale records found.</p>'}
  <h2>Recorded transfers</h2>${table(['Dog','Transfer date','Recipient','Record status'],transfers.map(d=>row([d.name,d.transferredAt,d.buyerName,d.transferStatus || 'DACO confirmation not verified'])))}
  <h2>Health records</h2>${table(['Dog','Type','Product / result','Event date','Next due','Vet / lab','Record status'],healthRows)}
  <h2>Audit history</h2><p>A kennel-level activity audit is not available from the current iDogs export. Movement entries and daily care records above are owner-entered records, not an independent system audit.</p>
  <p><small>Source: iDogs account records and owner-entered facility logs. Blank fields appear as “Not recorded”. Supporting certificates, approval document and DACO transfer confirmation are referenced only when stated; no source attachment is embedded. Owner must reconcile records and approval wording before sending to Council.</small></p></body></html>`
}
