import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// LP-06B (Owner approved 21 Nov 2026): native Safari Smart App Banner only.
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const APP_ID = '6823094602' // verified: apps.apple.com/au/app/idogs/id6823094602, seller IZIPAWS PTY LTD

describe('Safari Smart App Banner (LP-06B)', () => {
  it('declares exactly one apple-itunes-app meta with the official iDogs app id', () => {
    const tags = html.match(/<meta\s+name="apple-itunes-app"[^>]*>/g) || []
    expect(tags).toHaveLength(1)
    expect(tags[0]).toContain(`content="app-id=${APP_ID}"`)
  })

  it('stays native-only: no affiliate data or app-argument deep link', () => {
    const tag = html.match(/<meta\s+name="apple-itunes-app"[^>]*>/)![0]
    expect(tag).not.toMatch(/affiliate-data|app-argument/)
  })

  it('uses the same app id as the homepage App Store links', () => {
    const landing = readFileSync(new URL('../pages/LandingPage.tsx', import.meta.url), 'utf8')
    expect(landing).toContain(`apps.apple.com/au/app/idogs/id${APP_ID}`)
  })
})
