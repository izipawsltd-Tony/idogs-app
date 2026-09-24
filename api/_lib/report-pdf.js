// Render report HTML into a real, selectable PDF. No browser print dialog is involved.
import { readFile } from 'node:fs/promises'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { load } from 'cheerio'

const GREEN = rgb(26/255, 58/255, 42/255)
const PALE = rgb(232/255, 241/255, 235/255)
const BAND = rgb(244/255, 246/255, 243/255)
const INK = rgb(32/255, 49/255, 41/255)
const MUTED = rgb(83/255, 101/255, 90/255)
const WHITE = rgb(1, 1, 1)
const M = 34
const normalise = s => String(s ?? '').replace(/\s+/g, ' ').trim()

export async function reportPDF(html, { title = 'iDogs Council review report', landscape = true } = {}) {
  const $ = load(html)
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const [regularBytes, boldBytes] = await Promise.all([
    readFile(new URL('./fonts/DejaVuSans.ttf', import.meta.url)),
    readFile(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)),
  ])
  const regular = await doc.embedFont(regularBytes, { subset: true })
  const bold = await doc.embedFont(boldBytes, { subset: true })
  const size = landscape ? [841.89, 595.28] : [595.28, 841.89]
  const contentWidth = size[0] - M * 2
  let page, y
  const newPage = () => {
    page = doc.addPage(size)
    page.drawRectangle({ x: M, y: size[1] - 30, width: contentWidth, height: 4, color: GREEN })
    page.drawText('iDogs  /  COUNCIL REVIEW', { x: M, y: size[1] - 44, font: bold, size: 8, color: GREEN })
    y = size[1] - 60
  }
  const room = height => { if (y - height < M + 20) newPage() }
  const widthOf = (s, font, fs) => font.widthOfTextAtSize(s, fs)
  const wrap = (text, font, fs, width) => {
    const words = normalise(text).split(' ')
    const lines = []; let line = ''
    for (let word of words) {
      if (!word) continue
      while (widthOf(word, font, fs) > width && word.length > 1) {
        let n = 1; while (n < word.length && widthOf(word.slice(0,n+1),font,fs) <= width) n++
        if (line) { lines.push(line); line = '' }
        lines.push(word.slice(0,n)); word = word.slice(n)
      }
      const candidate = line ? `${line} ${word}` : word
      if (widthOf(candidate,font,fs) > width && line) { lines.push(line); line = word } else line = candidate
    }
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  }
  const paragraph = (text, fs = 9, strong = false, gap = 8) => {
    const font = strong ? bold : regular
    const lines = wrap(text,font,fs,contentWidth)
    for (const line of lines) { room(fs * 1.5); page.drawText(line,{x:M,y,font,size:fs,color:INK}); y -= fs * 1.5 }
    y -= gap
  }
  const heading = (text, level = 2) => {
    const fs = level === 1 ? 17 : level === 2 ? 12 : 10
    room(fs * 2.6)
    y -= level === 1 ? 7 : 11
    for (const line of wrap(text,bold,fs,contentWidth)) { room(fs * 1.4); page.drawText(line,{x:M,y,font:bold,size:fs,color:GREEN}); y -= fs * 1.4 }
    y -= 3
  }
  const drawTable = element => {
    const head = $(element).find('thead tr').first().children('th,td').map((_,e)=>normalise($(e).text())).get()
    const cells = tr => $(tr).children('th,td').toArray().map(e=>normalise($(e).text()))
    const body = $(element).find('tbody tr').toArray().map(cells)
    const fallback = $(element).find('tr').toArray().map(cells)
    const columns = head.length ? head : fallback[0] || []
    const rows = head.length ? body : fallback.slice(1)
    if (!columns.length) return
    const cw = contentWidth / columns.length, fs = columns.length > 8 ? 6.1 : columns.length > 6 ? 6.7 : 7.6, leading = fs * 1.4, pad = 5
    const render = (values, header, shade, start = 0, count = null) => {
      const lines = columns.map((_,i)=>wrap(values[i] ?? '',header ? bold : regular,fs,cw-pad*2))
      const max = count ?? Math.max(1,...lines.map(x=>x.length))
      const height = max * leading + pad * 2
      room(height)
      page.drawRectangle({x:M,y:y-height+4,width:contentWidth,height,color:header?GREEN:shade?BAND:WHITE})
      for(let i=0;i<columns.length;i++) {
        const x=M+i*cw
        page.drawLine({start:{x,y:y+4},end:{x,y:y-height+4},thickness:.3,color:PALE})
        lines[i].slice(start,start+max).forEach((line,j)=>page.drawText(line,{x:x+pad,y:y-pad-fs-j*leading,font:header?bold:regular,size:fs,color:header?WHITE:INK}))
      }
      y -= height
      page.drawLine({start:{x:M,y:y+4},end:{x:M+contentWidth,y:y+4},thickness:.4,color:PALE})
      return lines
    }
    room(55); render(columns,true,false)
    if (!rows.length) { paragraph('No records found.',8); return }
    rows.forEach((values, ri) => {
      let start=0
      const lines=columns.map((_,i)=>wrap(values[i] ?? '',regular,fs,cw-pad*2))
      const total=Math.max(1,...lines.map(x=>x.length))
      while(start<total) {
        const capacity=Math.max(1,Math.floor((y-(M+20)-pad*2)/leading))
        if(capacity<2) { newPage(); render(columns,true,false); continue }
        const count=Math.min(total-start,capacity)
        render(values,false,ri%2===1,start,count)
        start+=count
        if(start<total) { newPage(); render(columns,true,false) }
      }
    })
    y -= 8
  }
  newPage()
  const walk = node => {
    if (node.type !== 'tag') return
    const tag=node.name
    if (['style','script','svg','button'].includes(tag)) return
    if (tag === 'table') { drawTable(node); return }
    if (/^h[1-6]$/.test(tag)) { heading($(node).text(),Number(tag[1])); return }
    if (tag === 'p') { paragraph($(node).text()); return }
    if (tag === 'li') { paragraph(`• ${$(node).text()}`,8); return }
    if (tag === 'br') return
    if (tag === 'div' && $(node).hasClass('meta')) {
      $(node).children().each((_,child)=>{
        const label = normalise($(child).find('strong').first().text())
        const value = normalise($(child).text().slice(label.length))
        paragraph(`${label}: ${value}`,8,true,3)
      }); y-=5; return
    }
    if (tag === 'div' && ($(node).hasClass('brand') || $(node).hasClass('subtitle'))) { paragraph($(node).text(),8,false,2); return }
    if (tag === 'div' && ($(node).hasClass('details') || $(node).hasClass('banner'))) { paragraph($(node).text(),8,false,8); return }
    if (tag === 'header') { $(node).children().each((_,child)=>walk(child)); return }
    $(node).children().each((_,child)=>walk(child))
  }
  $('body').children().each((_,node)=>walk(node))
  const pages=doc.getPages()
  pages.forEach((p,i)=>{
    p.drawLine({start:{x:M,y:26},end:{x:size[0]-M,y:26},thickness:.5,color:PALE})
    p.drawText(title,{x:M,y:13,font:regular,size:7,color:MUTED})
    const count=`Page ${i+1} of ${pages.length}`
    p.drawText(count,{x:size[0]-M-widthOf(count,regular,7),y:13,font:regular,size:7,color:MUTED})
  })
  return Buffer.from(await doc.save())
}
