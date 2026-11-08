import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Owner QA 176 (08 Nov): the dog avatar could not be picked from the photo
// library. capture="..." makes iOS open the camera only (no Photo Library,
// no Files). No file input in the app may force camera-only capture.
const srcDir = fileURLToPath(new URL('..', import.meta.url))
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(name) && !/\.test\./.test(name) ? [p] : []
})

describe('file pickers offer Photo Library and Files on iPhone', () => {
  it('the dog avatar picker does not force the camera', () => {
    const photo = readFileSync(join(srcDir, 'components/ui/PhotoUpload.tsx'), 'utf8')
    expect(photo).toContain('accept="image/*"')
    expect(photo).not.toMatch(/capture=/)
  })
  it('no component sets a capture attribute on a file input', () => {
    const offenders = files(srcDir).filter(f => /\bcapture=["{]/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
