export function centsToMoneyText(cents) {
  return cents == null ? '' : (cents / 100).toFixed(2)
}

export function parseMoneyLive(text, previousCents) {
  const trimmed = text.trim()
  if (trimmed === '') return null
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '.') return previousCents
  const dollars = Number(trimmed)
  if (!Number.isFinite(dollars) || dollars < 0) return previousCents
  return Math.round(dollars * 100)
}

export function parseMoneyCommit(text) {
  const trimmed = text.trim()
  if (trimmed === '') return { cents: null, error: null }
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { cents: null, error: 'Enter a valid amount like 2500 or 2500.00' }
  }
  const dollars = Number(trimmed)
  if (!Number.isFinite(dollars) || dollars < 0 || !Number.isSafeInteger(Math.round(dollars * 100))) {
    return { cents: null, error: 'Enter a valid amount like 2500 or 2500.00' }
  }
  return { cents: Math.round(dollars * 100), error: null }
}
