// api/export-report.js — Universal Audit Report generator
// Supports: per-dog, per-litter, full-kennel × PDF + CSV

import { initializeApp, getApps, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'idogs-app.firebasestorage.app',
  })
}

const db = getFirestore()

function formatDate(str) {
  if (!str) return '—'
  try {
    const d = new Date(str)
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return str }
}

// ── DATA FETCHERS ─────────────────────────────────────────────

async function fetchDogFull(dogId) {
  const [dogSnap, vaccines, health, worming, litters] = await Promise.all([
    db.collection('dogs').doc(dogId).get(),
    db.collection('vaccineRecords').where('dogId', '==', dogId).get(),
    db.collection('healthTests').where('dogId', '==', dogId).get(),
    db.collection('wormingRecords').where('dogId', '==', dogId).get(),
    db.collection('litters').where('puppyIds', 'array-contains', dogId).get(),
  ])
  if (!dogSnap.exists) return null
  return {
    ...dogSnap.data(), id: dogSnap.id,
    vaccines: vaccines.docs.map(d => ({ ...d.data(), id: d.id })),
    healthTests: health.docs.map(d => ({ ...d.data(), id: d.id })),
    wormings: worming.docs.map(d => ({ ...d.data(), id: d.id })),
    litter: litters.docs[0]?.data() || null,
  }
}

async function fetchLitterFull(litterId) {
  const litterSnap = await db.collection('litters').doc(litterId).get()
  if (!litterSnap.exists) return null
  const litter = { ...litterSnap.data(), id: litterSnap.id }
  const puppies = await Promise.all((litter.puppyIds || []).map(id => fetchDogFull(id)))
  return { ...litter, puppies: puppies.filter(Boolean) }
}

async function fetchKennelFull(tenantId) {
  const [userSnap, dogsSnap, littersSnap] = await Promise.all([
    db.collection('users').doc(tenantId).get(),
    db.collection('dogs').where('tenantId', '==', tenantId).get(),
    db.collection('litters').where('tenantId', '==', tenantId).get(),
  ])
  const dogs = await Promise.all(dogsSnap.docs.map(d => fetchDogFull(d.id)))
  return {
    profile: userSnap.data(),
    dogs: dogs.filter(Boolean),
    litters: littersSnap.docs.map(d => ({ ...d.data(), id: d.id })),
  }
}

async function fetchBreedingFull(dogId) {
  const [dogSnap, heatCyclesSnap] = await Promise.all([
    db.collection('dogs').doc(dogId).get(),
    db.collection('heatCycles').where('dogId', '==', dogId).get(),
  ])
  if (!dogSnap.exists) return null
  const heatCycles = heatCyclesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.heatNumber - b.heatNumber)
  return { ...dogSnap.data(), id: dogSnap.id, heatCycles }
}

// ── CSV GENERATORS ────────────────────────────────────────────

function dogToCSVRows(dog) {
  const rows = []
  // Dog info row
  rows.push(['DOG', dog.name, dog.breed, dog.sex, formatDate(dog.dateOfBirth),
    dog.colour || '', dog.microchip || '', dog.ankc || '', dog.passportId || '',
    dog.status === 'transferred' ? `Transferred to ${dog.buyerName}` : 'Active'])

  // Vaccine rows
  for (const v of dog.vaccines || []) {
    rows.push(['VACCINE', dog.name, v.name, formatDate(v.dateGiven),
      formatDate(v.nextDue), v.vetClinic || '', v.uncertain ? 'Uncertain' : 'Confirmed', '', '', ''])
  }

  // Health test rows
  for (const h of dog.healthTests || []) {
    rows.push(['HEALTH_TEST', dog.name, h.testType?.toUpperCase(), h.result,
      formatDate(h.dateTested), h.lab || '', h.certNumber || '', '', '', ''])
  }

  // Worming rows
  for (const w of dog.wormings || []) {
    rows.push(['WORMING', dog.name, w.product, formatDate(w.dateGiven),
      formatDate(w.nextDue), '', '', '', '', ''])
  }

  return rows
}

function generateCSV(data, scope) {
  const headers = ['Record Type', 'Dog Name', 'Detail 1', 'Detail 2',
    'Detail 3', 'Detail 4', 'Detail 5', 'Detail 6', 'Detail 7', 'Status']
  const rows = [headers]

  if (scope === 'dog') {
    rows.push(...dogToCSVRows(data))
  } else if (scope === 'litter') {
    rows.push(['LITTER', data.name, formatDate(data.actualBirthDate),
      `${data.puppies?.length || 0} puppies`, '', '', '', '', '', ''])
    for (const puppy of data.puppies || []) {
      rows.push(...dogToCSVRows(puppy))
    }
  } else if (scope === 'kennel') {
    for (const dog of data.dogs || []) {
      rows.push(...dogToCSVRows(dog))
    }
    for (const litter of data.litters || []) {
      rows.push(['LITTER', litter.name, formatDate(litter.actualBirthDate),
        `${litter.puppyIds?.length || 0} puppies`, '', '', '', '', '', ''])
    }
  }

  return rows.map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')).join('\n')
}

// ── PDF HTML GENERATOR ────────────────────────────────────────

function dogHTML(dog, showTitle = true) {
  const isTransferred = dog.status === 'transferred'
  return `
    ${showTitle ? `<h2 class="dog-title">🐾 ${dog.name}</h2>` : ''}
    <table class="info-table">
      <tr><th>Breed</th><td>${dog.breed || '—'}</td><th>Sex</th><td>${dog.sex === 'female' ? 'Female ♀' : 'Male ♂'}</td></tr>
      <tr><th>Date of Birth</th><td>${formatDate(dog.dateOfBirth)}</td><th>Colour</th><td>${dog.colour || '—'}</td></tr>
      <tr><th>Microchip</th><td>${dog.microchip || '—'}</td><th>Dogs Australia Reg</th><td>${dog.ankc || '—'}</td></tr>
      <tr><th>Passport ID</th><td>${dog.passportId || '—'}</td><th>Status</th><td class="${isTransferred ? 'status-transferred' : 'status-active'}">${isTransferred ? `Transferred to ${dog.buyerName}` : 'Active'}</td></tr>
    </table>

    ${dog.vaccines?.length > 0 ? `
    <h3>Vaccination Records</h3>
    <table class="data-table">
      <thead><tr><th>Vaccine</th><th>Date Given</th><th>Next Due</th><th>Vet Clinic</th><th>Status</th></tr></thead>
      <tbody>
        ${dog.vaccines.map(v => `
          <tr>
            <td>${v.name}${v.uncertain ? ' <span class="uncertain">⚠ uncertain</span>' : ''}</td>
            <td>${formatDate(v.dateGiven)}</td>
            <td>${formatDate(v.nextDue)}</td>
            <td>${v.vetClinic || '—'}</td>
            <td class="${new Date(v.nextDue) < new Date() ? 'overdue' : 'current'}">${new Date(v.nextDue) < new Date() ? 'Overdue' : 'Current'}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : '<p class="no-records">No vaccination records.</p>'}

    ${dog.healthTests?.length > 0 ? `
    <h3>Health Tests</h3>
    <table class="data-table">
      <thead><tr><th>Test Type</th><th>Result</th><th>Date Tested</th><th>Lab / Cert</th></tr></thead>
      <tbody>
        ${dog.healthTests.map(h => `
          <tr>
            <td>${h.testType?.toUpperCase() || '—'}</td>
            <td><strong>${h.result}</strong></td>
            <td>${formatDate(h.dateTested)}</td>
            <td>${h.lab || '—'}${h.certNumber ? ` · ${h.certNumber}` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : ''}

    ${dog.wormings?.length > 0 ? `
    <h3>Worming Records</h3>
    <table class="data-table">
      <thead><tr><th>Product</th><th>Date Given</th><th>Next Due</th></tr></thead>
      <tbody>
        ${dog.wormings.map(w => `
          <tr><td>${w.product}</td><td>${formatDate(w.dateGiven)}</td><td>${formatDate(w.nextDue)}</td></tr>`).join('')}
      </tbody>
    </table>` : ''}
  `
}

function generatePDFHTML(data, scope, profile) {
  const now = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const kennelName = profile?.kennelName || profile?.firstName || 'iDogs'
  const breederName = `${profile?.firstName || ''} ${profile?.lastName || ''}`.trim()

  let bodyContent = ''
  let reportTitle = ''

  if (scope === 'dog') {
    reportTitle = `Dog Health Record — ${data.name}`
    bodyContent = dogHTML(data, false)
  } else if (scope === 'litter') {
    reportTitle = `Litter Report — ${data.name}`
    bodyContent = `
      <table class="info-table">
        <tr><th>Litter Name</th><td>${data.name}</td><th>Birth Date</th><td>${formatDate(data.actualBirthDate)}</td></tr>
        <tr><th>Expected Due</th><td>${formatDate(data.expectedDueDate)}</td><th>Puppies</th><td>${data.puppies?.length || 0}</td></tr>
        ${data.notes ? `<tr><th>Notes</th><td colspan="3">${data.notes}</td></tr>` : ''}
      </table>
      <h3>Puppies</h3>
      ${(data.puppies || []).map(p => `<div class="puppy-section">${dogHTML(p)}</div>`).join('<hr class="puppy-divider">')}
    `
  } else if (scope === 'kennel') {
    reportTitle = `Full Kennel Audit Report — ${kennelName}`
    bodyContent = `
      <h2>Kennel Information</h2>
      <table class="info-table">
        <tr><th>Kennel Name</th><td>${kennelName}</td><th>Breeder</th><td>${breederName}</td></tr>
        <tr><th>State</th><td>${profile?.state || '—'}</td><th>Dogs Australia Reg</th><td>${profile?.ankc || '—'}</td></tr>
        <tr><th>Email</th><td>${profile?.email || '—'}</td><th>Phone</th><td>${profile?.phone || '—'}</td></tr>
        <tr><th>Total Dogs</th><td>${data.dogs?.length || 0}</td><th>Total Litters</th><td>${data.litters?.length || 0}</td></tr>
      </table>

      <h2>Dog Records</h2>
      ${(data.dogs || []).map(dog => `<div class="dog-section">${dogHTML(dog)}</div><div class="page-break"></div>`).join('')}

      ${data.litters?.length > 0 ? `
      <h2>Litter Records</h2>
      <table class="data-table">
        <thead><tr><th>Litter Name</th><th>Birth Date</th><th>Puppies</th><th>Notes</th></tr></thead>
        <tbody>
          ${data.litters.map(l => `
            <tr>
              <td>${l.name}</td>
              <td>${formatDate(l.actualBirthDate)}</td>
              <td>${l.puppyIds?.length || 0}</td>
              <td>${l.notes || '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : ''}
    `
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1A1917; background: white; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #085041; }
  .header-left .logo { font-size: 22px; font-weight: 700; color: #085041; margin-bottom: 4px; }
  .header-left .tagline { font-size: 10px; color: #9A9891; }
  .header-right { text-align: right; }
  .header-right .report-title { font-size: 16px; font-weight: 600; color: #1A1917; margin-bottom: 4px; }
  .header-right .report-meta { font-size: 10px; color: #9A9891; }
  h2 { font-size: 14px; font-weight: 600; color: #085041; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #E1F5EE; }
  h2.dog-title { font-size: 16px; }
  h3 { font-size: 12px; font-weight: 600; color: #5C5A54; margin: 16px 0 8px; }
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .info-table th { width: 15%; background: #F0FAF5; color: #085041; font-weight: 600; padding: 7px 10px; text-align: left; border: 1px solid #E1F5EE; font-size: 10px; }
  .info-table td { padding: 7px 10px; border: 1px solid #E2DFD8; color: #1A1917; }
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .data-table thead th { background: #085041; color: white; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10px; }
  .data-table tbody tr:nth-child(even) { background: #F5F0E8; }
  .data-table tbody td { padding: 7px 10px; border-bottom: 1px solid #E2DFD8; }
  .current { color: #085041; font-weight: 600; }
  .overdue { color: #C0392B; font-weight: 600; }
  .uncertain { color: #C8971F; font-size: 9px; }
  .status-active { color: #085041; font-weight: 600; }
  .status-transferred { color: #5C5A54; }
  .no-records { color: #9A9891; font-style: italic; margin: 8px 0 16px; }
  .dog-section { margin-bottom: 24px; }
  .puppy-section { margin: 16px 0; }
  .puppy-divider { border: none; border-top: 1px dashed #E2DFD8; margin: 20px 0; }
  .page-break { page-break-after: always; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #E2DFD8; display: flex; justify-content: space-between; font-size: 9px; color: #9A9891; }
  .compliance-badge { background: #E1F5EE; color: #085041; padding: 4px 10px; border-radius: 4px; font-size: 9px; font-weight: 600; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="logo">🐾 iDogs</div>
      <div class="tagline">Every dog's story, forever · idogs.com.au</div>
    </div>
    <div class="header-right">
      <div class="report-title">${reportTitle}</div>
      <div class="report-meta">Generated: ${now} · Australian Universal Audit Report</div>
    </div>
  </div>

  ${bodyContent}

  <div class="footer">
    <span>Generated by iDogs · idogs.com.au · ${now}</span>
    <span class="compliance-badge">🇦🇺 AU Universal Compliance Report</span>
  </div>
</body>
</html>`
}

// ── BREEDING COMPLIANCE PDF ───────────────────────────────────

const MATING_METHOD_LABELS = {
  natural: 'Natural mating (supervised)',
  natural_unsup: 'Natural mating (unsupervised)',
  vaginal_ai_fresh: 'Vaginal AI — Fresh semen',
  vaginal_ai_chilled: 'Vaginal AI — Fresh-chilled',
  tci_fresh: 'TCI — Fresh semen',
  tci_chilled: 'TCI — Fresh-chilled semen',
  tci_frozen: 'TCI — Frozen-thawed semen',
  other: 'Other',
}
const WHELPING_METHOD_LABELS = {
  natural: 'Natural whelp',
  assisted: 'Assisted whelp',
  csection_elective: 'C-section (elective)',
  csection_emergency: 'C-section (emergency)',
}

const STATE_RULES_EXPORT = {
  SA:  { maxLifetime: 5, maxLittersIn18m: 2, maxCsections: null, maxAge: 8 },
  NSW: { maxLifetime: 5, maxLittersIn18m: null, maxCsections: 3, maxAge: 8 },
  VIC: { maxLifetime: 5, maxLittersIn18m: 2, maxCsections: null, maxAge: 8 },
  QLD: { maxLifetime: 5, maxLittersIn18m: 2, maxCsections: null, maxAge: 8 },
  WA:  { maxLifetime: 5, maxLittersIn18m: null, maxCsections: null, maxAge: 7 },
  ACT: { maxLifetime: 5, maxLittersIn18m: 2, maxCsections: null, maxAge: 8 },
  NT:  { maxLifetime: 5, maxLittersIn18m: 2, maxCsections: null, maxAge: 8 },
  TAS: { maxLifetime: 5, maxLittersIn18m: 2, maxCsections: null, maxAge: 8 },
}

function generateBreedingPDFHTML(dog, profile, userState) {
  const now = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  const state = userState || profile?.state || 'SA'
  const rules = STATE_RULES_EXPORT[state] || STATE_RULES_EXPORT['SA']

  const dob = dog.dateOfBirth ? new Date(dog.dateOfBirth) : null
  const today = new Date()
  const ageMo = dob ? (today.getFullYear() - dob.getFullYear()) * 12 + (today.getMonth() - dob.getMonth()) : 0

  const litterCount = dog.litterCount ?? 0
  const cSectionCount = dog.cSectionCount ?? 0
  const last18mLitters = dog.last18mLitters ?? 0
  const pedigreeRegister = dog.pedigreeRegister || 'main'

  const isLimited = pedigreeRegister === 'limited'
  const isNoPedigree = ['no_pedigree', 'mixed', 'rescue'].includes(pedigreeRegister)
  const isUnder12 = ageMo < 12
  const isOver = ageMo / 12 >= rules.maxAge
  const littersOk = litterCount < rules.maxLifetime
  const last18Ok = !rules.maxLittersIn18m || last18mLitters < rules.maxLittersIn18m
  const csectionOk = !rules.maxCsections || cSectionCount < rules.maxCsections

  const overallOk = !isLimited && !isNoPedigree && !isUnder12 && !isOver && littersOk && last18Ok && csectionOk
  const statusColor = overallOk ? '#085041' : isLimited || !littersOk || !csectionOk || !last18Ok ? '#C0392B' : '#C8971F'
  const statusText = isNoPedigree ? 'No pedigree — cannot register litters with Dogs Australia'
    : isLimited ? 'Limited Register — not eligible to breed'
    : !littersOk ? `Lifetime litter limit reached (${rules.maxLifetime} max)`
    : !csectionOk ? `C-section limit reached (${rules.maxCsections} max)`
    : !last18Ok ? 'Too many litters in last 18 months'
    : isUnder12 ? 'Not eligible — under 12 months'
    : isOver ? `Over ${rules.maxAge} years — vet certificate required`
    : 'Currently eligible to breed'

  const pedigreeLabel = {
    main: '🔵 Main Register (Blue) — eligible to breed',
    limited: '🟠 Limited Register (Orange) — NOT eligible to breed',
    no_pedigree: 'No pedigree (purebred without papers)',
    mixed: 'Mixed breed / crossbreed',
    rescue: 'Rescue / unknown background',
  }[pedigreeRegister] || '—'

  const heatCycles = dog.heatCycles || []

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 11px; color: #1A1917; background: white; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid #085041; }
  .header-left .logo { font-size: 22px; font-weight: 700; color: #085041; margin-bottom: 4px; }
  .header-left .tagline { font-size: 10px; color: #9A9891; }
  .header-right { text-align: right; }
  .header-right .report-title { font-size: 16px; font-weight: 600; color: #1A1917; margin-bottom: 4px; }
  .header-right .report-meta { font-size: 10px; color: #9A9891; }
  h2 { font-size: 14px; font-weight: 600; color: #085041; margin: 24px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #E1F5EE; }
  h3 { font-size: 12px; font-weight: 600; color: #5C5A54; margin: 16px 0 8px; }
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .info-table th { width: 18%; background: #F0FAF5; color: #085041; font-weight: 600; padding: 7px 10px; text-align: left; border: 1px solid #E1F5EE; font-size: 10px; }
  .info-table td { padding: 7px 10px; border: 1px solid #E2DFD8; color: #1A1917; }
  .data-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  .data-table thead th { background: #085041; color: white; padding: 8px 10px; text-align: left; font-weight: 600; font-size: 10px; }
  .data-table tbody tr:nth-child(even) { background: #F5F0E8; }
  .data-table tbody td { padding: 7px 10px; border-bottom: 1px solid #E2DFD8; vertical-align: top; }
  .status-banner { padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid ${statusColor}; background: ${overallOk ? '#E1F5EE' : '#FFF8F8'}; }
  .status-banner .status-title { font-size: 13px; font-weight: 700; color: ${statusColor}; margin-bottom: 4px; }
  .status-banner .status-sub { font-size: 10px; color: #5C5A54; }
  .ok { color: #085041; font-weight: 600; }
  .fail { color: #C0392B; font-weight: 600; }
  .warn { color: #C8971F; font-weight: 600; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #E2DFD8; display: flex; justify-content: space-between; font-size: 9px; color: #9A9891; }
  .compliance-badge { background: #E1F5EE; color: #085041; padding: 4px 10px; border-radius: 4px; font-size: 9px; font-weight: 600; }
  .heat-card { border: 1px solid #E2DFD8; border-radius: 6px; margin-bottom: 12px; overflow: hidden; }
  .heat-card-header { background: #F0FAF5; padding: 8px 12px; font-weight: 600; font-size: 12px; color: #085041; border-bottom: 1px solid #E1F5EE; }
  .heat-card-body { padding: 8px 12px; display: grid; gap: 6px; }
  .heat-row { display: flex; gap: 8px; font-size: 10px; }
  .heat-label { color: #9A9891; min-width: 120px; }
  .heat-val { color: #1A1917; font-weight: 500; }
  .disclaimer { margin-top: 24px; padding: 10px 14px; background: #F5F0E8; border-radius: 6px; font-size: 9px; color: #9A9891; line-height: 1.6; }
</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="logo">🐾 iDogs</div>
      <div class="tagline">Every dog's story, forever · idogs.com.au</div>
    </div>
    <div class="header-right">
      <div class="report-title">Breeding Compliance Report — ${dog.name}</div>
      <div class="report-meta">Generated: ${now} · ${state} State Rules</div>
    </div>
  </div>

  <div class="status-banner">
    <div class="status-title">${statusText}</div>
    <div class="status-sub">${state} · Dogs Australia Regulations · Generated ${now}</div>
  </div>

  <h2>Dog Information</h2>
  <table class="info-table">
    <tr><th>Name</th><td>${dog.name || '—'}</td><th>Breed</th><td>${dog.breed || '—'}</td></tr>
    <tr><th>Date of Birth</th><td>${formatDate(dog.dateOfBirth)}</td><th>Age</th><td>${Math.floor(ageMo / 12)}yr ${ageMo % 12}mo</td></tr>
    <tr><th>Sex</th><td>${dog.sex === 'female' ? '♀ Female' : '♂ Male'}</td><th>Microchip</th><td>${dog.microchip || '—'}</td></tr>
    <tr><th>Dogs Australia Reg</th><td>${dog.ankc || '—'}</td><th>Passport ID</th><td>${dog.passportId || '—'}</td></tr>
    <tr><th>Pedigree Register</th><td colspan="3" class="${isLimited ? 'fail' : isNoPedigree ? 'warn' : 'ok'}">${pedigreeLabel}</td></tr>
  </table>

  <h2>Breeding Compliance Summary — ${state}</h2>
  <table class="info-table">
    <tr>
      <th>Lifetime litters</th>
      <td class="${littersOk ? 'ok' : 'fail'}">${litterCount} / ${rules.maxLifetime} max</td>
      <th>C-section litters</th>
      <td class="${csectionOk ? 'ok' : 'fail'}">${cSectionCount}${rules.maxCsections ? ` / ${rules.maxCsections} max` : ' (no state limit)'}</td>
    </tr>
    ${rules.maxLittersIn18m ? `<tr>
      <th>Litters last 18 months</th>
      <td class="${last18Ok ? 'ok' : 'fail'}">${last18mLitters} / ${rules.maxLittersIn18m} max</td>
      <th>Max breeding age</th>
      <td class="${isOver ? 'fail' : 'ok'}">${rules.maxAge} years${isOver ? ' — EXCEEDED' : ''}</td>
    </tr>` : `<tr>
      <th>Max breeding age</th>
      <td class="${isOver ? 'fail' : 'ok'}">${rules.maxAge} years${isOver ? ' — EXCEEDED' : ''}</td>
      <th>Min breeding age</th>
      <td class="${isUnder12 ? 'fail' : 'ok'}">12 months${isUnder12 ? ' — NOT MET' : ' — met'}</td>
    </tr>`}
    <tr>
      <th>Last litter date</th>
      <td>${formatDate(dog.lastLitterDate)}</td>
      <th>Breeder ID</th>
      <td>${dog.breederIdValue || profile?.breederIdValue || '—'}</td>
    </tr>
  </table>

  <h2>Heat Cycle Records (${heatCycles.length})</h2>
  ${heatCycles.length === 0 ? '<p style="color:#9A9891;font-style:italic;margin-bottom:16px">No heat cycles recorded.</p>' : ''}
  ${heatCycles.map(cycle => `
    <div class="heat-card">
      <div class="heat-card-header">
        Heat ${cycle.heatNumber}
        ${cycle.heatStartDate ? ` — Started ${formatDate(cycle.heatStartDate)}` : ''}
        ${cycle.whelpingActual ? ` · Whelped ${formatDate(cycle.whelpingActual)}` : ''}
      </div>
      <div class="heat-card-body">
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <tr>
            <td style="padding:3px 8px;color:#9A9891;width:20%">Heat dates</td>
            <td style="padding:3px 8px">${formatDate(cycle.heatStartDate)}${cycle.heatEndDate ? ` → ${formatDate(cycle.heatEndDate)}` : ''}</td>
            <td style="padding:3px 8px;color:#9A9891;width:20%">Mating date</td>
            <td style="padding:3px 8px">${formatDate(cycle.matingDate)}</td>
          </tr>
          <tr style="background:#F5F0E8">
            <td style="padding:3px 8px;color:#9A9891">Mating method</td>
            <td style="padding:3px 8px">${MATING_METHOD_LABELS[cycle.matingMethod] || cycle.matingMethod || '—'}</td>
            <td style="padding:3px 8px;color:#9A9891">Sire</td>
            <td style="padding:3px 8px">${cycle.sireName || '—'}${cycle.sireReg ? ` (${cycle.sireReg})` : ''}</td>
          </tr>
          <tr>
            <td style="padding:3px 8px;color:#9A9891">Progesterone test</td>
            <td style="padding:3px 8px">${cycle.progesteroneTested ? 'Yes' : 'No'}</td>
            <td style="padding:3px 8px;color:#9A9891">Vet / clinic</td>
            <td style="padding:3px 8px">${cycle.vetClinic || '—'}</td>
          </tr>
          <tr style="background:#F5F0E8">
            <td style="padding:3px 8px;color:#9A9891">Pregnancy confirmed</td>
            <td style="padding:3px 8px">${cycle.pregnancyConfirmed ? `Yes${cycle.ultrasoundDate ? ` (${formatDate(cycle.ultrasoundDate)})` : ''}` : 'No'}</td>
            <td style="padding:3px 8px;color:#9A9891">Whelping estimate</td>
            <td style="padding:3px 8px">${formatDate(cycle.whelpingEstimate)}</td>
          </tr>
          <tr>
            <td style="padding:3px 8px;color:#9A9891">Actual whelping</td>
            <td style="padding:3px 8px">${formatDate(cycle.whelpingActual)}</td>
            <td style="padding:3px 8px;color:#9A9891">Whelping method</td>
            <td style="padding:3px 8px">${WHELPING_METHOD_LABELS[cycle.whelpingMethod] || cycle.whelpingMethod || '—'}</td>
          </tr>
          <tr style="background:#F5F0E8">
            <td style="padding:3px 8px;color:#9A9891">Puppies born / alive</td>
            <td style="padding:3px 8px">${cycle.puppiesBorn !== undefined ? `${cycle.puppiesBorn} born / ${cycle.puppiesAlive ?? '?'} alive` : '—'}</td>
            <td style="padding:3px 8px;color:#9A9891">Notes</td>
            <td style="padding:3px 8px">${cycle.notes || '—'}</td>
          </tr>
        </table>
      </div>
    </div>
  `).join('')}

  <div class="disclaimer">
    ⚠️ Disclaimer: This report is based on data entered into iDogs and state legislation as at June 2026. Always verify compliance requirements with your state canine body before breeding. This report does not constitute legal or veterinary advice.
  </div>

  <div class="footer">
    <span>Generated by iDogs · idogs.com.au · ${now}</span>
    <span class="compliance-badge">🌸 Breeding Compliance Report · ${state}</span>
  </div>
</body>
</html>`
}

// ── MAIN HANDLER ──────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { scope, id, tenantId, format } = req.body
  if (!scope || !tenantId || !format) return res.status(400).json({ error: 'Missing params' })

  try {
    let data, profile

    // Fetch profile
    const userSnap = await db.collection('users').doc(tenantId).get()
    profile = userSnap.data()

    if (scope === 'dog') {
      data = await fetchDogFull(id)
      if (!data) return res.status(404).json({ error: 'Dog not found' })
    } else if (scope === 'litter') {
      data = await fetchLitterFull(id)
      if (!data) return res.status(404).json({ error: 'Litter not found' })
    } else if (scope === 'kennel') {
      data = await fetchKennelFull(tenantId)
    } else if (scope === 'breeding') {
      data = await fetchBreedingFull(id)
      if (!data) return res.status(404).json({ error: 'Dog not found' })
      // Breeding compliance is PDF only
      const html = generateBreedingPDFHTML(data, profile, req.body.userState)
      const filename = `${data.name}_breeding_compliance_${new Date().toISOString().slice(0,10)}`
      res.setHeader('Content-Type', 'application/json')
      return res.status(200).json({ html, filename })
    } else {
      return res.status(400).json({ error: 'Invalid scope' })
    }

    if (format === 'csv') {
      const csv = generateCSV(data, scope)
      const filename = scope === 'dog' ? `${data.name}_record.csv`
        : scope === 'litter' ? `${data.name}_litter.csv`
        : `kennel_audit_${new Date().toISOString().slice(0,10)}.csv`

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      return res.status(200).send(csv)
    }

    if (format === 'pdf') {
      const html = generatePDFHTML(data, scope, profile)
      // Return HTML for client-side PDF generation via print
      const filename = scope === 'dog' ? `${data.name}_record`
        : scope === 'litter' ? `${data.name}_litter`
        : `kennel_audit_${new Date().toISOString().slice(0,10)}`

      res.setHeader('Content-Type', 'application/json')
      return res.status(200).json({ html, filename })
    }

    return res.status(400).json({ error: 'Invalid format' })

  } catch (err) {
    console.error('Export error:', err)
    return res.status(500).json({ error: 'Export failed', message: String(err) })
  }
}
