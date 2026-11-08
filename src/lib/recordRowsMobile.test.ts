import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Owner device QA 08 Nov (TestFlight 175): on iPhone, the Vaccine and
// Worming rows squeezed the record text into a narrow column beside the
// buttons ("Drontal / adult", "Protech / C4 / (CDV, ..."). Rows must wrap:
// the details take the full width and the actions move to their own line.
const page = readFileSync(fileURLToPath(new URL('../pages/DogDetailPage.tsx', import.meta.url)), 'utf8')
const section = (from: string, to: string) => page.slice(page.indexOf(from), page.indexOf(to))

const tabs = {
  vaccines: section('function VaccinesTab', '// ── WORMING TAB'),
  worming: section('function WormingTab', '// ── HEALTH TAB'),
  health: section('function HealthTab', '// ── REMINDERS TAB'),
}

describe('record rows on a narrow iPhone screen', () => {
  for (const [name, tab] of Object.entries(tabs)) {
    it(`${name}: details wrap above a separate, wrapping actions group`, () => {
      expect(tab.length).toBeGreaterThan(100)
      expect(tab).toContain("flexWrap: 'wrap', gap: '8px")
      expect(tab).toContain("flex: '1 1 220px', minWidth: 0")
      expect(tab).toContain('data-testid="record-actions" style={{ display: \'flex\', alignItems: \'center\', gap: 8, flexWrap: \'wrap\', marginLeft: \'auto\' }}')
      expect(tab).not.toMatch(/<div style=\{\{ flex: 1 \}\}>/)
      expect(tab).not.toContain('flexShrink: 0 }}>\n                <span className="badge badge-green">Verified')
    })
  }
})
