import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(fileURLToPath(new URL('./DogListPage.tsx', import.meta.url)), 'utf8')

describe('DogListPage mobile UX regression', () => {
  it('uses a dedicated full-width scrolling filter strip below the mobile search row', () => {
    expect(source).toContain('.dog-list-controls')
    expect(source).toMatch(/@media \(max-width: 600px\)[\s\S]*?\.dog-list-controls\s*{[\s\S]*?flex-direction: column/)
    expect(source).toMatch(/\.dog-list-filters\s*{[\s\S]*?width: 100%[\s\S]*?min-width: 0[\s\S]*?overflow-x: auto/)
    expect(source).toContain('white-space: nowrap')
  })

  it('falls back after image load errors and keeps the no-photo treatment compact', () => {
    expect(source).toContain('onError={() => setPhotoFailed(true)}')
    expect(source).toContain("const showPhoto = Boolean(profilePhoto) && !photoFailed")
    expect(source).toMatch(/\.dog-list-photo-fallback\s*{[\s\S]*?height: 96px/)
    expect(source).toMatch(/@media \(max-width: 600px\)[\s\S]*?\.dog-list-photo-fallback\s*{ height: 68px; }/)
    expect(source).toContain('<span>No photo</span>')
  })
})
