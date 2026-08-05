export function centsToMoneyText(cents: number | null): string
export function parseMoneyLive(text: string, previousCents: number | null): number | null
export function parseMoneyCommit(text: string): { cents: number | null; error: string | null }
