import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { docCard } from './documentRow'

/**
 * Teardown that deletes ONLY the exact documents a run created, and never confuses
 * "the document is gone" with "I could not look".
 *
 * - The list must be proven loaded: the heading is visible AND the "<n> document(s) saved" line is
 *   shown. A failed load renders "Document count unavailable — load failed" instead, so that case
 *   throws here rather than being read as "nothing to delete".
 * - 0 cards titled exactly `title` after the list loaded = confirmed absent. More than 1 = ambiguous:
 *   throw, never pick by position. Exactly 1 = delete that card and require it to disappear.
 * - Any navigation, lookup, click or timeout error propagates (the caller fails the teardown).
 */
export type TeardownResult = { deleted: string[]; absent: string[] }

export async function teardownDocs(page: Page, titles: string[], opts: { deleteTimeoutMs?: number } = {}): Promise<TeardownResult> {
  await page.goto('/app/documents')
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/^\d+ documents? saved$/), 'document list loaded (not a load failure)').toBeVisible({ timeout: 20_000 })
  const result: TeardownResult = { deleted: [], absent: [] }
  for (const title of titles) {
    const card = docCard(page, title)
    const n = await card.count()
    if (n === 0) { result.absent.push(title); continue }
    if (n > 1) throw new Error(`teardown refused: ${n} documents share the exact title of this run's document`)
    const accept = (d: { accept(): Promise<void> }) => { void d.accept() }
    page.on('dialog', accept)
    try {
      await card.getByRole('button', { name: /Delete/ }).click()
      await expect(card).toHaveCount(0, { timeout: opts.deleteTimeoutMs ?? 15_000 })
    } finally {
      page.off('dialog', accept)
    }
    result.deleted.push(title)
  }
  return result
}
