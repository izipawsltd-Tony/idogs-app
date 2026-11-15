// Mobile performance budget for the public entry (landing / signup / QR):
// the entry script must stay small and must not statically pull in the
// Firestore or Storage SDKs (they are loaded on demand inside the app).
import { readFileSync, readdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
const BUDGET_GZIP_KB = Number(process.env.ENTRY_BUDGET_KB || 150)
const html = readFileSync('dist/index.html', 'utf8')
const entry = html.match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/)?.[1]
if (!entry) { console.error('entry script not found'); process.exit(1) }
const code = readFileSync(`dist/assets/${entry}`)
const gz = gzipSync(code).length / 1024
const preloads = [...html.matchAll(/rel="modulepreload"[^>]*href="\/assets\/([^"]+)"/g)].map(m => m[1])
const staticImports = [...code.toString().matchAll(/from\s*"\.\/([^"]+\.js)"/g)].map(m => m[1])
const firestoreInEntry = /google\.firestore\.v1|firestore\.googleapis\.com/.test(code.toString())
const storageInEntry = /firebasestorage\.googleapis\.com/.test(code.toString())
const errors = []
if (gz > BUDGET_GZIP_KB) errors.push(`entry ${entry} is ${gz.toFixed(1)} KB gzip > ${BUDGET_GZIP_KB} KB budget`)
if (firestoreInEntry) errors.push('Firestore SDK is bundled into the public entry script')
if (storageInEntry) errors.push('Storage SDK is bundled into the public entry script')
if ([...preloads, ...staticImports].some(f => /^firebase-/.test(f))) errors.push('entry statically imports the firebase (Firestore/Storage) chunk')
console.log(`entry ${entry}: ${gz.toFixed(1)} KB gzip; static imports: ${staticImports.join(', ') || 'none'}; chunks: ${readdirSync('dist/assets').length}`)
if (errors.length) { console.error(errors.join('\n')); process.exit(1) }
