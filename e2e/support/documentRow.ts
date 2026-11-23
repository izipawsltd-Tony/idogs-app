import type { Locator, Page } from '@playwright/test'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The Documents card whose TITLE is exactly `title`.
 *
 * Replaces the old `page.locator('div').filter({ hasText })....last()` helper, which matched any
 * ancestor/sibling div whose text merely CONTAINED the name, so with "Card" and "Card renamed" on
 * the page `.last()` could pick the other document's Delete button. This helper:
 *  - scopes to the real card (`data-testid="doc-card"`),
 *  - matches the title element exactly (not a substring, not the notes/dog text),
 *  - never uses `.last()`/`.first()`: if zero or several cards match, Playwright's strict mode
 *    refuses to act, so a click can never land on a different document.
 */
export function docCard(page: Page, title: string): Locator {
  return page
    .getByTestId('doc-card')
    .filter({ has: page.locator('.doc-card-title').filter({ hasText: new RegExp(`^\\s*${escapeRe(title)}\\s*$`) }) })
}

/**
 * Dog Detail → Documents tab has no card test ids. The row is the NEAREST ancestor div of the
 * element whose text is exactly `title` that contains a Delete button. Exact text, no `.last()`:
 * zero or several matching elements make Playwright's strict mode refuse to act.
 */
export function docRowByExactTitle(page: Page, title: string): Locator {
  return page
    .getByText(title, { exact: true })
    .locator('xpath=ancestor::div[.//button[contains(normalize-space(.), "Delete")]][1]')
}
