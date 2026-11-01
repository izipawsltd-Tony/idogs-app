// iOS native readiness regressions (01 Nov 2026).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : []
})

describe('iOS native readiness', () => {
  it('file pickers never force camera-only capture (iOS must offer Photo Library / Files / PDFs)', () => {
    const offenders = files(SRC).filter(f => /\bcapture=/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('QA-only routes are registered only in opt-in staging QA builds', () => {
    const app = readFileSync(join(SRC, 'components/App.tsx'), 'utf8')
    const gate = app.indexOf('{phoneEmailLinkStagingEnabled() && <>')
    expect(gate).toBeGreaterThan(-1)
    for (const route of ['/qa/phone-email-link', '/qa/phone-sign-in']) {
      expect(app.indexOf(route)).toBeGreaterThan(gate)
    }
    expect(app.match(/path="\/qa\//g)).toHaveLength(2)
  })

  it('video upload exists, so the iOS microphone purpose string is configured', () => {
    const usesVideo = files(SRC).some(f => /accept="video\//.test(readFileSync(f, 'utf8')))
    const privacy = readFileSync(join(SRC, '../mobile/scripts/ios_privacy.py'), 'utf8')
    if (usesVideo) expect(privacy).toContain('NSMicrophoneUsageDescription')
  })
})
