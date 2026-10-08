import { afterAll, describe, expect, it, vi } from 'vitest'
import { collection, getDocs, query, terminate, where } from 'firebase/firestore'
import { deleteApp, getApp } from 'firebase/app'

// Exercise the real installed SDK with its network disabled: no emulator,
// credentials, server requests or production data are involved.
vi.mock('./firebase', async () => {
  const { initializeApp } = await import('firebase/app')
  const { disableNetwork, getFirestore, setLogLevel } = await import('firebase/firestore')
  setLogLevel('silent')
  const app = initializeApp({ projectId: 'demo-idogs-offline-qa', apiKey: 'qa-only' }, 'qa-offline-read')
  const db = getFirestore(app)
  await disableNetwork(db)
  return { db, auth: { currentUser: { uid: 'qa-offline-reader' } } }
})

import { db } from './firebase'
import { getDogs, getAllDocumentsForUser, getAllPendingReminders, getLitters, getAuditLogs, GetDogsError } from './db'

afterAll(async () => {
  await terminate(db)
  await deleteApp(getApp('qa-offline-read'))
})

describe('cold offline collection reads', () => {
  it('reproduces the SDK empty-cache fallback that looks like an empty account', async () => {
    const snap = await getDocs(query(collection(db, 'dogs'), where('tenantId', '==', 'qa-offline-reader')))
    expect(snap.metadata.fromCache).toBe(true)
    expect(snap.empty).toBe(true)
  })

  it('reports unavailable Dogs instead of a successful empty list', async () => {
    await expect(getDogs()).rejects.toBeInstanceOf(GetDogsError)
  })

  it('does not turn an unavailable dog list into zero Documents', async () => {
    await expect(getAllDocumentsForUser('qa-offline-reader')).rejects.toBeInstanceOf(GetDogsError)
  })

  it('does not turn an unavailable dog list into zero Reminders', async () => {
    await expect(getAllPendingReminders()).rejects.toBeInstanceOf(GetDogsError)
  })

  it('reports unavailable Litters instead of an empty list', async () => {
    await expect(getLitters()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('reports unavailable audit activity instead of an empty list', async () => {
    await expect(getAuditLogs('qa-offline-reader')).rejects.toMatchObject({ code: 'unavailable' })
  })
})
