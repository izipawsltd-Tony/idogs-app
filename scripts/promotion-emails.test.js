import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { invitationEmail, renewalEmail, audienceDryRun, invitationDecision, UNSUBSCRIBE_TOKEN, REMINDER_AT, REMINDER_CHANNEL } from './lib/promotion-emails.js'
import { writeEmailPreviews } from './lib/promotion-email-preview.js'

const now = Date.parse('2026-10-22T12:00:00Z')
const eligible = overrides => ({
  email: 'owner@example.invalid', emailVerified: true, checkedAt: new Date(now).toISOString(),
  marketingPermission: 'verified', permissionEvidence: 'Synthetic reviewed permission record',
  suppressed: false, qaOrInternal: false, accountActive: true, deletionPending: false,
  effectivePlan: 'free', currentSubscription: false, promotionPendingOrJoined: false, ...overrides,
})

describe('promotion email review pack', () => {
  it('includes current benefits, billing CTA and full invitation disclosures in HTML and text', () => {
    const email = invitationEmail()
    for (const content of [email.html, email.text]) {
      for (const required of ['31 January 2027', '1 February 2027', 'Adelaide time', 'A$7/month', 'including GST', 'Payment details', 'SMS and extra litters', '2 litters', '10 iDogs Document Scans', 'https://idogs.com.au/app/billing', UNSUBSCRIBE_TOKEN]) expect(content).toContain(required)
    }
    expect(email.html).not.toContain('AI Document')
    expect(email.subject).toBe('iDogs Plus is free until 31 January 2027 🐾')
    expect(email.from).toBe('iDogs <noreply@idogs.com.au>')
  })
  it('escapes untrusted names and provides a friendly fallback', () => {
    for (const render of [invitationEmail, renewalEmail]) {
      const email = render({ firstName: '<img src=x onerror="alert(1)">' })
      expect(email.html).toContain('&lt;img')
      expect(email.html).not.toContain('<img')
      expect(render().html).toContain('Hi there,')
    }
  })
  it.each(['javascript:alert(1)', 'http://idogs.com.au', 'https://idogs.com.au.attacker.invalid', 'https://user:pass@idogs.com.au', '//billing.stripe.com/session'])('rejects unsafe or unapproved CTA %s', manageUrl => {
    expect(() => renewalEmail({ manageUrl })).toThrow()
    expect(() => invitationEmail({ unsubscribeUrl: manageUrl })).toThrow()
  })
  it('keeps a review-only renewal with a durable authenticated billing destination', () => {
    const email = renewalEmail()
    expect(email.draftOnly).toBe(true)
    expect(email.channel).toBe(REMINDER_CHANNEL)
    expect(email.channel).toBe('stripe-native')
    for (const body of [email.html, email.text]) {
      expect(body).toContain('https://idogs.com.au/app/billing')
      expect(body).toContain('1 February 2027')
      expect(body).toContain('A$7/month')
      expect(body).toContain('including GST')
      expect(body).toContain('saved payment method')
    }
    expect(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Adelaide', dateStyle: 'long' }).format(REMINDER_AT)).toBe('25 January 2027')
  })
})

describe('offline audience preflight (not a live inventory)', () => {
  it('requires positive, fresh, complete evidence', () => {
    expect(invitationDecision(eligible(), now)).toBe('eligible-for-owner-review')
    expect(invitationDecision({ emailReminders: true }, now)).not.toBe('eligible-for-owner-review')
    for (const field of Object.keys(eligible())) expect(invitationDecision(eligible({ [field]: undefined }), now)).not.toBe('eligible-for-owner-review')
  })
  it.each([
    [{ marketingPermission: 'denied' }, 'excluded-opt-out'], [{ suppressed: true }, 'excluded-opt-out'],
    [{ qaOrInternal: true }, 'excluded-qa-internal'], [{ accountActive: false }, 'excluded-account'],
    [{ deletionPending: true }, 'excluded-account'], [{ effectivePlan: 'plus' }, 'excluded-billing'],
    [{ currentSubscription: true }, 'excluded-billing'], [{ promotionPendingOrJoined: true }, 'excluded-billing'],
    [{ emailVerified: false }, 'hold-address'], [{ email: 'two@example.invalid,one@example.invalid' }, 'hold-address'],
    [{ checkedAt: new Date(now - 300001).toISOString() }, 'hold-stale'],
    [{ checkedAt: new Date(now + 1).toISOString() }, 'hold-stale'], [{ checkedAt: 'invalid' }, 'hold-stale'],
    [{ marketingPermission: 'unknown' }, 'hold-permission'], [{ permissionEvidence: ' ' }, 'hold-permission'],
  ])('holds or excludes %j', (overrides, reason) => expect(invitationDecision(eligible(overrides), now)).toBe(reason))
  it('closes invitations before Checkout enrollment closes', () => {
    expect(invitationDecision(eligible(), Date.parse('2027-01-31T13:00:00Z'))).toBe('campaign-closed')
    expect(invitationDecision(eligible(), Date.parse('2026-10-01T00:00:00Z'))).toBe('campaign-closed')
  })
  it('holds every duplicate and reveals no addresses or names in the report', () => {
    const result = audienceDryRun([eligible(), eligible({ email: 'OWNER@example.invalid', suppressed: true }), eligible({ email: 'other@example.invalid' })], now)
    expect(result.counts).toEqual({ 'hold-duplicate': 2, 'eligible-for-owner-review': 1 })
    expect(result.total).toBe(3)
    expect(result.mode).toBe('dry-run-no-send')
    expect(JSON.stringify(result)).not.toContain('@')
    expect(() => audienceDryRun({})).toThrow()
  })
})

it('emits only synthetic Preview artifacts and no production artifacts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'idogs-email-review-'))
  try {
    await writeEmailPreviews(dir, 'production')
    expect(await readdir(dir)).toEqual([])
    await writeEmailPreviews(dir, undefined)
    expect(await readdir(dir)).toEqual([])
    await writeEmailPreviews(dir, 'preview')
    const html = await readFile(join(dir, '__qa/promotion-emails/invitation.html'), 'utf8')
    expect(html).toContain('noindex,nofollow')
    expect(html).toContain('Not sent')
    expect(html).toContain(UNSUBSCRIBE_TOKEN)
    expect(html).toContain('Hi there,')
    expect(await readFile(join(dir, '__qa/promotion-emails/renewal.html'), 'utf8')).toContain('Manage or cancel subscription')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
