import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, request, test, type BrowserContext } from '@playwright/test'
import { bootstrapPreviewCookie, createPreviewContext } from './support/previewContext'

// Self-contained harness check (no Preview, no secrets): two local origins stand in for the
// Preview (127.0.0.1) and "everything else" (localhost). A dummy sentinel is used as the bypass
// secret. The Preview origin must receive it (header once, then cookie); the other origin must
// never receive the header or the cookie: not via subresources, fetch, redirects, popups or the
// request client.

const SENTINEL = 'SENTINEL-BYPASS-0f3c9a'
type Hit = { origin: 'preview' | 'external'; path: string; header: boolean; cookie: boolean }
const hits: Hit[] = []
let preview = '', external = ''
const servers: http.Server[] = []

function serve(kind: Hit['origin'], handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  return new Promise<string>(resolve => {
    const s = http.createServer((req, res) => {
      hits.push({ origin: kind, path: new URL(req.url!, 'http://x').pathname, header: req.headers['x-vercel-protection-bypass'] === SENTINEL, cookie: String(req.headers.cookie || '').includes(SENTINEL) })
      handler(req, res)
    })
    servers.push(s)
    s.listen(0, kind === 'preview' ? '127.0.0.1' : 'localhost', () => resolve(`http://${kind === 'preview' ? '127.0.0.1' : 'localhost'}:${(s.address() as AddressInfo).port}`))
  })
}

test.use({ trace: 'off', screenshot: 'off', video: 'off' })

test.beforeAll(async () => {
  external = await serve('external', (_req, res) => { res.setHeader('access-control-allow-origin', '*'); res.end('ext') })
  preview = await serve('preview', (req, res) => {
    const path = new URL(req.url!, 'http://x').pathname
    const authed = req.headers['x-vercel-protection-bypass'] === SENTINEL || String(req.headers.cookie || '').includes(SENTINEL)
    if (req.headers['x-vercel-protection-bypass'] === SENTINEL && req.headers['x-vercel-set-bypass-cookie']) {
      // Like Vercel: set the bypass cookie, then redirect. Redirect to the OTHER origin on purpose:
      // the harness must not follow it with the secret header attached.
      res.writeHead(307, { 'set-cookie': `_vercel_jwt=${SENTINEL}; Path=/; HttpOnly; SameSite=Lax`, location: `${external}/bootstrap-redirect` })
      return res.end()
    }
    if (!authed) { res.statusCode = 401; return res.end('protected') }
    if (path === '/redir-ext') { res.writeHead(302, { location: `${external}/after-redirect` }); return res.end() }
    if (path === '/api/echo') return res.end('{}')
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><img src="${external}/pixel.gif"><script>fetch('${external}/xhr');fetch('/redir-ext')</script><iframe src="/redir-ext"></iframe><a id="pop" target="_blank" href="${external}/signed-url">open</a>`)
  })
})
test.afterAll(() => { for (const s of servers) s.close() })

async function exercise(context: BrowserContext) {
  const page = await context.newPage()
  await page.goto(`${preview}/`)
  expect(page.url().startsWith(preview), 'protected Preview page loads via cookie').toBe(true)
  const popup = context.waitForEvent('page')
  await page.click('#pop')
  await (await popup).waitForLoadState()
  await page.goto(`${preview}/redir-ext`) // top-level navigation redirecting off-origin
  await context.request.post(`${preview}/api/echo`, { data: {} }) // request client, same origin
  await context.request.get(`${preview}/redir-ext`) // request client following an off-origin redirect
  await context.request.get(`${external}/direct`) // request client, other origin
  await page.waitForTimeout(500)
  await context.close()
}

function verify(expectedHeaderSends: number) {
  const ext = hits.filter(h => h.origin === 'external')
  const prev = hits.filter(h => h.origin === 'preview')
  expect(ext.map(h => h.path)).toEqual(expect.arrayContaining(['/pixel.gif', '/xhr', '/after-redirect', '/signed-url', '/direct']))
  expect(ext.some(h => h.path === '/bootstrap-redirect'), 'bootstrap redirect not followed').toBe(false)
  expect(ext.filter(h => h.header || h.cookie).map(h => h.path), 'no sentinel on the other origin').toEqual([])
  expect(prev.filter(h => h.header).length, 'secret header sent exactly once (bootstrap)').toBe(expectedHeaderSends)
  expect(prev.filter(h => !h.header).every(h => h.cookie), 'every later Preview request authenticated by cookie').toBe(true)
  expect(prev.some(h => h.path === '/api/echo' && h.cookie), 'request client carries the Preview cookie').toBe(true)
}

test.beforeEach(() => { hits.length = 0 })

test('createPreviewContext (LP-11 spec): bypass secret reaches only the exact Preview origin', async ({ browser }) => {
  await exercise(await createPreviewContext(browser, preview, SENTINEL))
  verify(1)
})

test('global setup storageState (page/context fixtures): bypass secret reaches only the Preview origin', async ({ browser }) => {
  const rc = await request.newContext()
  await bootstrapPreviewCookie(rc, new URL(preview).origin, SENTINEL)
  const storageState = await rc.storageState()
  await rc.dispose()
  await exercise(await browser.newContext({ storageState }))
  verify(1)
})
