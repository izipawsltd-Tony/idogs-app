import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import HistoricalPassport, { passportInfoRows } from '../components/ui/HistoricalPassport'
import type { HealthTest, VaccineRecord } from '../types'

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

// Snapshot fixture shaped like BLA-2026-TDNB at transfer: the frozen dog doc
// still holds private owner fields, which must never reach the view.
const snapshotDog = {
  name: 'Bella', breed: 'Labrador Retriever', sex: 'female', dateOfBirth: '2026-06-01', colour: 'Black',
  passportId: 'BLA-2026-TDNB', profilePhoto: 'https://storage.googleapis.com/b/dogs/breeder/dog1/profile.jpg',
  photos: [{ id: 'p1', path: 'dogs/breeder/dog1/photos/a.jpg' }],
  microchip: '956000000000001', currentOwnerId: 'buyer-uid', buyerEmail: 'buyer@example.invalid', buyerName: 'New Owner', notes: 'new-owner-secret-note',
}
const vaccines = [{ id: 'v1', dogId: 'dog1', name: 'C3', dateGiven: '2026-07-20', nextDue: '2026-08-20' }] as VaccineRecord[]
const healthTests = [{ id: 'h1', dogId: 'dog1', testType: 'hip', result: '4:5', dateTested: '2026-07-01' }] as unknown as HealthTest[]
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON())
const click = (r: ReactTestRenderer, label: string) => act(async () => { r.root.findAll(n => n.type === 'button' && n.children.join('') === label)[0].props.onClick() })

describe('former owner QR Passport at transfer', () => {
  it('shows the passport as it stood at transfer, read-only, with no live passport link or QR', async () => {
    const loadPhotos = vi.fn().mockResolvedValue({ photos: [{ id: 'p1', url: 'https://signed.example/a.jpg' }] })
    let r!: ReactTestRenderer
    await act(async () => { r = create(createElement(HistoricalPassport, { dog: snapshotDog, transferredAt: '2026-08-01T00:00:00Z', vaccines, healthTests, loadPhotos })) })
    expect(text(r)).toContain('BLA-2026-TDNB')
    expect(text(r)).toContain('C3')
    expect(text(r)).toContain('Read-only')
    expect(r.root.findAll(n => n.type === 'a')).toHaveLength(0)
    expect(r.root.findAll(n => n.type === 'input' || n.type === 'textarea')).toHaveLength(0)
    expect(loadPhotos).not.toHaveBeenCalled()

    await click(r, 'Health')
    expect(text(r)).toContain('4:5')

    await click(r, 'Info')
    for (const hidden of ['956000000000001', 'buyer@example.invalid', 'New Owner', 'new-owner-secret-note', 'buyer-uid']) expect(text(r)).not.toContain(hidden)

    await click(r, 'Photos')
    expect(loadPhotos).toHaveBeenCalledTimes(1)
    expect(r.root.findAllByType('img').map(i => i.props.src)).toEqual(['https://signed.example/a.jpg'])
  })

  it('info rows use only the public passport fields', () => {
    expect(passportInfoRows(snapshotDog).map(r => r[0])).toEqual(['Name', 'Breed', 'Sex', 'Date of birth', 'Colour', 'Dog ID'])
  })

  it('shows a retry when transfer photos cannot be loaded', async () => {
    const loadPhotos = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ photos: [] })
    let r!: ReactTestRenderer
    await act(async () => { r = create(createElement(HistoricalPassport, { dog: snapshotDog, vaccines: [], healthTests: [], loadPhotos })) })
    await click(r, 'Photos')
    expect(text(r)).toContain('unavailable')
    await click(r, 'Retry')
    expect(loadPhotos).toHaveBeenCalledTimes(2)
    expect(text(r)).toContain('no longer available')
  })

  it('DogDetailPage renders it only from the transfer snapshot, never the live passport', () => {
    const page = read('../pages/DogDetailPage.tsx')
    const branch = page.slice(page.indexOf("{tab === 'passport' && (historicalSnapshot"), page.indexOf("{tab === 'documents'"))
    expect(branch).toContain('<HistoricalPassport dog={historicalSnapshot.dog || dog}')
    expect(branch.split(':')[0]).not.toContain('PassportTab')
    // Former-owner records on this page come only from the snapshot.
    expect(page).toContain('setVaccines(history.vaccineRecords || [])')
    expect(page).toContain('setHealthTests(history.healthTests || [])')
  })

  it('the photo endpoint serves the snapshot gallery to anyone who is not the current owner', () => {
    const api = read('../../api/get-showcase-media-urls.js')
    expect(api).toMatch(/where\('fromOwnerId', '==', uid\)/)
    expect(api).toContain('mediaDog = latest.data().dog || {}')
  })
})
