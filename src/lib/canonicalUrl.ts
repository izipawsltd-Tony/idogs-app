const IDOGS_CANONICAL_ORIGIN = 'https://idogs.com.au'

export function canonicalPassportUrl(input: string): string {
  try {
    const parsed = new URL(input, IDOGS_CANONICAL_ORIGIN)
    if (!parsed.pathname.startsWith('/p/')) return IDOGS_CANONICAL_ORIGIN
    return `${IDOGS_CANONICAL_ORIGIN}${parsed.pathname}`
  } catch {
    return IDOGS_CANONICAL_ORIGIN
  }
}
