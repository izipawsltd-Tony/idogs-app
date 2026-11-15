import { describe, expect, it } from 'vitest'
import {
  buildTransferEmailMessage,
  TRANSFER_EMAIL_ACTION_LABEL,
  TRANSFER_EMAIL_ACTION_URL,
} from './transferEmailCopy'

describe('transfer email copy', () => {
  it('contains one clear ownership/access flow and no raw passport link', () => {
    const message = buildTransferEmailMessage({
      breederName: 'NN GOLDEN',
      dogName: 'Pink Girl',
      breed: 'Labrador Retriever',
    })
    expect(message).toContain('NN GOLDEN has transferred ownership of Pink Girl')
    expect(message).toContain('Sign in to iDogs')
    expect(message).toContain('Create your free account')
    expect(message).not.toContain('/p/')
    expect(message).not.toContain('vercel.app')
    expect(message).not.toContain('passport here')
    expect(message).not.toContain('http://')
    expect(message).not.toContain('https://')
  })

  it('uses the trusted iDogs login CTA', () => {
    expect(TRANSFER_EMAIL_ACTION_URL).toBe('https://idogs.com.au/login')
    expect(TRANSFER_EMAIL_ACTION_LABEL).toBe('Access your dog →')
  })
})
