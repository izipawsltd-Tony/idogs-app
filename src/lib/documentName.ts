// Single source of truth for a document's display name.
// Upload stores the user-entered name as `title` (api/upload-document.js);
// Edit stores a rename as `name`. A type label (e.g. "Pedigree Certificate")
// is only a fallback when the user supplied no name at all — it must never
// replace one (Owner QA bug, 01 Nov 2026: "Mum's pedigree" shown as
// "Pedigree Certificate" on the Dog Detail Documents tab).
export function documentDisplayName(
  doc: { name?: unknown; title?: unknown; documentType?: unknown } | null | undefined,
  typeLabel: (type: string) => string,
): string {
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return clean(doc?.name) || clean(doc?.title) || typeLabel(String(doc?.documentType || 'other'))
}

/** Value to pre-fill the rename field with: the name the user currently sees, if it is theirs. */
export function documentEditableName(doc: { name?: unknown; title?: unknown } | null | undefined): string {
  const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return clean(doc?.name) || clean(doc?.title)
}
