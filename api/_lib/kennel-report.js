// Read-only presentation model for kennel exports. It never infers on-site
// occupancy or council approval from a dog's account status.
const value = (v) => v == null || v === '' ? 'Not recorded' : String(v)
export const escapeHTML = (v) => value(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const isoDay = (v) => {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null
}
const csvCell = v => `"${String(v == null ? '' : v).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""')}"`

export function buildKennelReport(data, profile = {}, generatedAt = new Date()) {
  profile = profile || {}
  const dogs = data.dogs || []
  const litters = data.litters || []
  const byId = new Map(dogs.map(d => [d.id, d]))
  const issues = []
  const add = (subject, id, message) => issues.push({ subject, id, message })
  const chips = new Map()
  for (const dog of dogs) {
    const chip = String(dog.microchip || '').trim()
    if (!chip) add('Dog', dog.id, 'Microchip not recorded; confirm age, sale status or exemption')
    else {
      if (chips.has(chip) && chips.get(chip) !== dog.id) add('Dog', dog.id, `Microchip ${chip} also appears on dog ${chips.get(chip)}`)
      chips.set(chip, dog.id)
    }
    const dob = isoDay(dog.dateOfBirth)
    if (!dob) add('Dog', dog.id, 'Date of birth missing or invalid')
    for (const [kind, records, dateKey] of [
      ['Vaccination', dog.vaccines, 'dateGiven'], ['Worming', dog.wormings, 'dateGiven'],
      ['Health test', dog.healthTests, 'dateTested'],
    ]) for (const record of records || []) {
      const day = isoDay(record[dateKey])
      if (!day) add(kind, record.id, `Event date missing or invalid for dog ${dog.id}`)
      else if (dob && day < dob) add(kind, record.id, `Event ${day} precedes dog ${dog.id} birth ${dob}`)
      if (record.nextDue && isoDay(record.nextDue) && day && isoDay(record.nextDue) < day) {
        add(kind, record.id, `Next due date precedes event date for dog ${dog.id}`)
      }
    }
  }
  for (const litter of litters) {
    if (!litter.actualBirthDate) add('Litter', litter.id, 'Actual birth date not recorded; may be planned or incomplete')
    for (const id of litter.puppyIds || []) if (!byId.has(id)) add('Litter', litter.id, `Puppy ${id} is not in this kennel export`)
    if (litter.damId && !byId.has(litter.damId)) add('Litter', litter.id, `Dam ${litter.damId} is not in this kennel export`)
  }
  if (!profile.kennelName) add('Profile', 'kennel', 'Kennel name not recorded')
  if (!profile.breederIdValue && !profile.breederNumber) add('Profile', 'breeder', 'Breeder registration number not recorded')
  add('Facility', 'occupancy', 'On-site occupancy and approval limits cannot be verified from these records')
  return { dogs, litters, byId, issues, profile, generatedAt: generatedAt.toISOString(),
    status: 'DRAFT — DATA REQUIRES REVIEW' }
}

export function kennelCSV(report) {
  // A single typed long table remains usable in Excel without a new dependency.
  const headers = ['Record Type', 'Record ID', 'Dog ID', 'Litter ID', 'Name / Product', 'Breed / Result', 'Sex', 'Date of birth / Event', 'Next due', 'Microchip', 'Registration', 'Vet / Lab', 'Status / Note']
  const rows = [headers]
  for (const d of report.dogs) {
    rows.push(['DOG', d.id, d.id, d.litterId, d.name, d.breed, d.sex, d.dateOfBirth, '', d.microchip, d.ankc, '', d.status])
    if (d.transferredAt || d.status === 'transferred') rows.push(['TRANSFER', d.id, d.id, d.litterId, d.buyerName, '', '', d.transferredAt, '', d.microchip, '', '', d.transferStatus || 'Transfer recorded; DACO confirmation not verified'])
    for (const v of d.vaccines || []) rows.push(['VACCINE', v.id, d.id, d.litterId, v.name, '', '', v.dateGiven, v.nextDue, '', '', v.vetClinic, v.uncertain ? 'Uncertain' : 'Recorded'])
    for (const w of d.wormings || []) rows.push(['WORMING', w.id, d.id, d.litterId, w.product, '', '', w.dateGiven, w.nextDue, '', '', '', 'Recorded'])
    for (const h of d.healthTests || []) rows.push(['HEALTH_TEST', h.id, d.id, d.litterId, h.testType, h.result, '', h.dateTested, '', '', h.certNumber, h.lab, 'Recorded'])
  }
  for (const l of report.litters) rows.push(['LITTER', l.id, l.damId, l.id, l.name, `Sire: ${value(l.sireName || l.sireId)}; puppies: ${(l.puppyIds || []).length}`, '', l.actualBirthDate, l.expectedDueDate, '', '', '', l.archived ? 'Archived' : 'Recorded'])
  for (const issue of report.issues) rows.push(['ISSUE', issue.id, '', '', issue.subject, '', '', '', '', '', '', '', issue.message])
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}

export function kennelHTML(report) {
  const e = escapeHTML
  const p = report.profile
  const row = cells => `<tr>${cells.map(c => `<td>${e(c)}</td>`).join('')}</tr>`
  const table = (heads, rows) => `<table><thead><tr>${heads.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
  const dogRows = report.dogs.map(d => row([d.id, d.name, d.breed, d.sex, d.dateOfBirth, d.microchip, d.status]))
  const litterRows = report.litters.map(l => row([l.id, l.name, report.byId.get(l.damId)?.name || l.damId, l.sireName || report.byId.get(l.sireId)?.name || l.sireId, l.actualBirthDate, (l.puppyIds || []).map(id => `${report.byId.get(id)?.name || 'Missing'} (${id})`).join('; ')]))
  const healthRows = report.dogs.flatMap(d => [
    ...(d.vaccines || []).map(v => row([d.id, v.id, 'Vaccination', v.name, v.dateGiven, v.nextDue, v.vetClinic, v.uncertain ? 'Uncertain' : 'Recorded'])),
    ...(d.wormings || []).map(w => row([d.id, w.id, 'Worming', w.product, w.dateGiven, w.nextDue, '', 'Recorded'])),
    ...(d.healthTests || []).map(h => row([d.id, h.id, 'Health test', `${value(h.testType)}: ${value(h.result)}`, h.dateTested, '', h.lab, h.certNumber])),
  ])
  const transfers = report.dogs.filter(d => d.transferredAt || d.status === 'transferred')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Kennel records — ${e(p.kennelName)}</title><style>
  @page{size:A4 landscape;margin:16mm}body{font:11px Arial,sans-serif;color:#18251e}h1,h2{color:#1A3A2A}h1{font-size:22px}h2{font-size:16px;margin-top:24px;break-after:avoid}p{line-height:1.45}.banner{padding:12px;background:#fff4d6;border-left:4px solid #b77900}table{border-collapse:collapse;width:100%;margin:10px 0 18px;table-layout:fixed}th,td{border:1px solid #d6ded8;padding:6px;overflow-wrap:anywhere;text-align:left;vertical-align:top}th{background:#e8f1eb}tr{break-inside:avoid}small{color:#555}@media print{thead{display:table-header-group}}
  </style></head><body><h1>Kennel records report</h1><p class="banner"><strong>${e(report.status)}</strong><br>Review the issues below and source records before sharing. This report does not certify Council approval or on-site occupancy.</p>
  <p><strong>Kennel:</strong> ${e(p.kennelName)} &nbsp; <strong>Breeder:</strong> ${e(`${p.firstName || ''} ${p.lastName || ''}`.trim())} &nbsp; <strong>State:</strong> ${e(p.state)}<br>
  <strong>Breeder ID:</strong> ${e(p.breederIdValue || p.breederNumber)} &nbsp; <strong>Contact:</strong> ${e(p.email)} / ${e(p.phone)}<br><strong>Generated:</strong> ${e(report.generatedAt)} &nbsp; <strong>Scope:</strong> All kennel records in this iDogs account as at generation; historical occupancy is unavailable.</p>
  <h2>Summary</h2><p>${report.dogs.length} dog records · ${report.litters.length} litter records · ${report.issues.length} review items. “Active” is an account status and does not establish physical presence or compliance with a facility cap.</p>
  <h2>Review items</h2>${table(['Subject','Record ID','Issue'],report.issues.map(i=>row([i.subject,i.id,i.message])))}
  <h2>Dog register</h2>${table(['Dog ID','Name','Breed','Sex','DOB','Microchip','Status'],dogRows)}
  <h2>Litters and puppies</h2>${table(['Litter ID','Name','Dam','Sire','Birth date','Linked puppies'],litterRows)}
  <h2>Recorded transfers</h2>${table(['Dog ID','Dog','Transfer date','Recipient','Record status'],transfers.map(d=>row([d.id,d.name,d.transferredAt,d.buyerName,d.transferStatus || 'DACO confirmation not verified'])))}
  <h2>Health records</h2>${table(['Dog ID','Event ID','Type','Product / result','Event date','Next due','Vet / lab','Record status'],healthRows)}
  <p><small>Source: iDogs account records. Blank fields appear as “Not recorded”. Supporting certificates, DACO transfer confirmation, facility approval conditions and daily operations logs are not attached to this export.</small></p></body></html>`
}
