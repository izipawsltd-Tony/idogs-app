import { describe, it, expect, vi } from 'vitest'
import { withUploadNetworkError, type UploadStage } from './directUploadNetwork'

describe('direct upload transport failures', () => {
  for (const [stage, message] of [
    ['request', 'Could not start the upload.'],
    ['storage', 'Could not send the file to storage.'],
    ['confirmation', 'The file was sent, but its upload could not be confirmed.'],
  ] as const) {
    it(`${stage} identifies the failed step without raw URL, credentials or cause`, async () => {
      const request = vi.fn().mockRejectedValue(new TypeError('https://storage.invalid/private?signature=SYNTHETIC Authorization=SYNTHETIC'))
      const error = await withUploadNetworkError(stage as UploadStage, request).catch(e => e)
      if (!(error instanceof Error)) throw new Error('Expected a safe upload error')
      expect(error.message).toContain(message)
      expect(error.message).not.toMatch(/https:|signature|Authorization|SYNTHETIC/)
      expect('cause' in error).toBe(false)
      expect(request).toHaveBeenCalledTimes(1)
    })
    it(`${stage} preserves HTTP failures for the caller and does not retry`, async () => {
      const response = new Response('synthetic validation error', { status: 403 })
      const request = vi.fn().mockResolvedValue(response)
      expect(await withUploadNetworkError(stage, request)).toBe(response)
      expect(request).toHaveBeenCalledTimes(1)
    })
  }
})
