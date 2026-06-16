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
      <tr><th>Microchip</th><td>${dog.microchip || '—'}</td><th>ANKC</th><td>${dog.ankc || '—'}</td></tr>
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
        <tr><th>State</th><td>${profile?.state || '—'}</td><th>ANKC</th><td>${profile?.ankc || '—'}</td></tr>
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
