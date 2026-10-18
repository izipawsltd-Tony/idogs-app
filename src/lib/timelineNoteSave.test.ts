import { describe, expect, it, vi } from 'vitest'
import { saveNoteWithPhoto, TimelinePhotoError } from './timelineNoteSave'

describe('Timeline photo persistence', () => {
  it.each([401, 403, 500, 504])('does not write a photo-less note after upload HTTP %s', async status => {
    const save = vi.fn()
    await expect(saveNoteWithPhoto(async () => new Response('', { status }), save)).rejects.toBeInstanceOf(TimelinePhotoError)
    expect(save).not.toHaveBeenCalled()
  })
  it('does not write after a network failure or malformed success', async () => {
    for (const upload of [async (): Promise<Response> => { throw new Error('offline') }, async () => Response.json({success:true}), async () => Response.json({fileUrl:'javascript:alert(1)'})]) {
      const save = vi.fn()
      await expect(saveNoteWithPhoto(upload, save)).rejects.toBeInstanceOf(TimelinePhotoError)
      expect(save).not.toHaveBeenCalled()
    }
  })
  it('persists the successful photo URL and supports deliberate text-only notes', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    await saveNoteWithPhoto(async () => Response.json({fileUrl:'https://storage.googleapis.com/qa/photo.jpg'}), save)
    expect(save).toHaveBeenLastCalledWith('https://storage.googleapis.com/qa/photo.jpg')
    await saveNoteWithPhoto(null, save)
    expect(save).toHaveBeenLastCalledWith(undefined)
  })
})
