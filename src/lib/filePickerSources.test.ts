import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const files = (dir: string): string[] => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? files(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : []
})

it('file pickers never force camera-only capture (mobile users must reach Photos/Files/PDFs)', () => {
  expect(files(SRC).filter(f => /\bcapture=/.test(readFileSync(f, 'utf8')))).toEqual([])
})
