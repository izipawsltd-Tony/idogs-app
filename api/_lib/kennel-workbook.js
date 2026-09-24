// Council workbook generated with ExcelJS for broad Excel and Excel Online compatibility.
import ExcelJS from 'exceljs'
import { issueLabel } from './kennel-report.js'

const day = v => { if (!v) return ''; const d = new Date(v); return Number.isNaN(+d) || d.getUTCFullYear() < 1900 ? 'Invalid date' : new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) }
const label = (r, id) => r.byId.get(id)?.name || (id ? 'Unlinked dog' : 'Not recorded')
const human = v => v ? String(v).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()) : ''
export async function kennelWorkbook(r) {

  const f=r.facility||{}, p=r.profile||{}, verifiable=r.daily.every(d=>d.verifiable)
  const puppyRows = r.puppies || [], cycles = r.heatCycles || []
  const latest = (records, key) => [...(records||[])].filter(x=>x[key]).sort((a,b)=>String(b[key]).localeCompare(String(a[key])))[0]?.[key]
  const saleDogs = r.dogs.filter(d=>d.availabilityStatus==='sold'||d.availabilityStatus==='reserved'||d.depositStatus==='received'||d.transferredAt||d.status==='transferred')
  const sheets=[
    ['Report Summary',[
      ['Council review report','Value'],['Status',r.status],['Reporting period',`${day(r.period.from)} to ${day(r.period.to)}`],['Generated',day(r.generatedAt)],['Kennel',f.facilityName||p.kennelName],['Facility address',f.address],['Council',f.council],['Approval number',f.approvalNumber],['Approval document',f.approvalDocumentRef],['Approval conditions',f.conditionNotes],['Breeder ID',p.breederIdValue||p.breederNumber],['Dog records',r.dogs.length],['Current account dogs',r.dogs.filter(d=>d.status!=='transferred'&&!d.isDeceased).length],['Breeding females in account',r.dogs.filter(d=>d.sex==='female'&&!d.litterId&&d.status!=='transferred'&&!d.isDeceased).length],['Litter records',r.litters.length],['Linked puppy records',new Set(puppyRows.filter(x=>x.dog).map(x=>x.id)).size],['Breeding events',cycles.length],['Health events',r.dogs.reduce((n,d)=>n+(d.vaccines||[]).length+(d.wormings||[]).length+(d.healthTests||[]).length,0)],['Recorded deposit total (AUD)',saleDogs.filter(d=>d.depositStatus==='received').reduce((n,d)=>n+(Number(d.depositAmount)||0),0)],['Review items',r.issues.length],['Occupancy evidence',verifiable?'Owner attested ledger; reconcile with source records':'Not verifiable from the recorded ledger'],['Audit history','Not available from the current kennel export'],['Scope','Dog and litter registers include historical account records; daily occupancy and care cover only the reporting period. Account status does not establish physical presence.'],['Evidence','Source records and attachments are not embedded. Owner must review the approval and supporting documents before sharing.']]],
    ['Dogs Register',[['Dog','Breed','Sex','Date of birth','Colour','Microchip','Registration','Account status','Availability','Litter'],...r.dogs.map(d=>[d.name,d.breed,human(d.sex),day(d.dateOfBirth),d.colour,d.microchip,d.ankc,human(d.status),human(d.availabilityStatus),r.litters.find(l=>l.id===d.litterId)?.name||''])]],
    ['Breeding Register',[['Dam','Sire','Heat started','Mating date','Pregnancy confirmed','Ultrasound date','Expected whelping','Actual whelping','Puppies born','Puppies alive','Vet / clinic','Notes'],...cycles.map(c=>[label(r,c.dogId),c.sireName||label(r,c.sireId),day(c.heatStartDate),day(c.matingDate),c.pregnancyConfirmed?'Yes':'No',day(c.ultrasoundDate),day(c.whelpingEstimate),day(c.whelpingActual),c.puppiesBorn,c.puppiesAlive,c.vetClinic,c.notes])]],
    ['Litters & Puppies',[['Litter','Dam','Sire','Actual birth','Expected due','Recorded puppies','Puppy','Status','Sex','Colour','Microchip','Last vaccination','Last worming','Recipient','Transfer status'],...r.litters.flatMap(l=>{const ids=l.puppyIds||[];return (ids.length?ids:[null]).map(id=>{const d=r.byId.get(id);return [l.name,label(r,l.damId),l.sireName||label(r,l.sireId),day(l.actualBirthDate),day(l.expectedDueDate),ids.length,d?.name||(id?'Unlinked puppy':'No puppy records'),human(d?.availabilityStatus),human(d?.sex),d?.colour,d?.microchip,day(latest(d?.vaccines,'dateGiven')),day(latest(d?.wormings,'dateGiven')),d?.buyerName,human(d?.transferStatus)]})})]],
    ['Sales & Transfers',[['Record type','Dog / puppy','Litter','Recipient / buyer','Availability','Deposit status','Deposit amount (AUD)','Transfer date','Transfer status'],...saleDogs.flatMap(d=>{const rows=[];if(d.availabilityStatus==='sold'||d.availabilityStatus==='reserved'||d.depositStatus==='received')rows.push(['Sale record',d.name,r.litters.find(l=>l.id===d.litterId)?.name,d.buyerName||d.reservedForName,human(d.availabilityStatus),human(d.depositStatus),d.depositAmount,'','']);if(d.transferredAt||d.status==='transferred')rows.push(['Ownership transfer',d.name,r.litters.find(l=>l.id===d.litterId)?.name,d.buyerName,'','','',day(d.transferredAt),human(d.transferStatus)||'Confirmation not verified']);return rows})]],
    ['Health & Vaccination',[['Subject','Litter','Type','Product or test','Result','Event date','Next due','Vet or lab','Certificate','Uncertain'],...r.dogs.flatMap(d=>{const litter=r.litters.find(l=>l.id===d.litterId)?.name;return [...(d.vaccines||[]).map(v=>[d.name,litter,'Vaccination',v.name,'',day(v.dateGiven),day(v.nextDue),v.vetClinic,'',v.uncertain?'Yes':'No']),...(d.wormings||[]).map(w=>[d.name,litter,'Worming',w.product,'',day(w.dateGiven),day(w.nextDue),'','','No']),...(d.healthTests||[]).map(h=>[d.name,litter,'Health test',h.testType,h.result,day(h.dateTested),'',h.lab,h.certNumber,'No'])]})]],
    ['Daily occupancy',[['Date','Evidence status','Breeding females','Breeding males','Boarding','Puppies','Other','Peak females','Peak males','Peak boarding'],...r.daily.map(d=>[day(d.date),d.verifiable?'Owner attested ledger':'Not verifiable',d.breedingFemale,d.breedingMale,d.boarding,d.puppies,d.other,d.peak?.breedingFemale,d.peak?.breedingMale,d.peak?.boarding])]],
    ['Movements',[['Date and time','Dog','Direction','Category','Note','Record status'],...r.movements.map(m=>[m.occurredAt,label(r,m.dogId),m.direction,m.category,m.note,m.voidedAt?`Voided: ${m.voidReason || 'reason not recorded'}`:'Recorded'])]],
    ['Daily care',[['Date','Caretaker','Exercise minutes','Care notes','Incidents'],...r.dailyLogs.map(l=>[day(l.date),l.caretaker,l.exerciseMinutes,l.careNotes,l.incidentNotes])]],
    ['Data Quality',[['Area','Record','Action required','Priority'],...r.issues.map(i=>[i.subject,issueLabel(r,i),i.message,/approval|ledger|microchip|linked|different litter|invalid|uncertain|test record/i.test(i.message)?'High':'Medium'])]],
  ]
  const book = new ExcelJS.Workbook()
  book.creator = 'iDogs'
  book.subject = 'Council review report'
  const green = 'FF1A3A2A', pale = 'FFE8F1EB', band = 'FFF4F6F3'
  for (const [name, records] of sheets) {
    const ws = book.addWorksheet(name, { pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
    const width = Math.max(4, ...records.map(row => row.length))
    const kennel = r.facility?.facilityName || r.profile?.kennelName || 'Kennel name not recorded'
    const header = [
      `iDogs  |  ${name}`,
      `Kennel: ${kennel}     Council: ${r.facility?.council || 'Not recorded'}`,
      `Reporting period: ${day(r.period.from)} – ${day(r.period.to)}     Generated: ${day(r.generatedAt)} (Australia/Adelaide)`,
      `Report status: ${r.status}`,
    ]
    ws.columns = Array.from({ length: width }, (_, j) => ({ width: Math.min(42, Math.max(j === 0 ? 24 : 16, String(records[0]?.[j] || '').length + 4, ...records.slice(1, 51).map(row => Math.min(42, String(row[j] ?? '').length + 2)))) }))
    header.forEach((value, i) => {
      ws.mergeCells(i + 1, 1, i + 1, width)
      const row = ws.getRow(i + 1); row.height = i === 0 ? 36 : 25
      const cell = row.getCell(1); cell.value = value
      cell.font = { name: 'Arial', size: i === 0 ? 16 : 10, bold: i === 0, color: { argb: i === 0 ? 'FFFFFFFF' : green } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 0 ? green : i === 3 ? band : pale } }
      cell.alignment = { vertical: 'middle', indent: 1 }
    })
    const rows = records.length > 1 ? records : [...records, ['No records found']]
    rows.forEach((values, i) => {
      const row = ws.getRow(i + 5)
      row.values = values.map(v => typeof v === 'number' && Number.isFinite(v) ? v : String(v ?? ''))
      row.height = i === 0 ? 32 : Math.min(108, Math.max(24, Math.ceil(Math.max(...values.map((v,j) => String(v ?? '').length / Math.max(10, (ws.getColumn(j+1).width || 16)-3)))) * 17))
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.font = { name: 'Arial', size: 10, bold: i === 0, color: { argb: i === 0 ? 'FFFFFFFF' : 'FF203129' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i === 0 ? green : i % 2 === 0 ? band : 'FFFFFFFF' } }
        cell.alignment = { vertical: 'middle', wrapText: true }
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFDCE5DE' } } }
        if (i > 0 && typeof cell.value === 'number' && (/AUD/.test(String(rows[0]?.[col-1] || '')) || /AUD/.test(String(values[0] || '')))) cell.numFmt = '"$"#,##0.00'
      })
    })
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 5 }]
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: rows.length + 4, column: width } }
    ws.pageSetup.margins = { left: .3, right: .3, top: .55, bottom: .55, header: .2, footer: .2 }
    ws.headerFooter.oddFooter = '&LiDogs Council review report&RPage &P'
    ws.printTitlesRow = '1:5'
  }
  return Buffer.from(await book.xlsx.writeBuffer())
}
