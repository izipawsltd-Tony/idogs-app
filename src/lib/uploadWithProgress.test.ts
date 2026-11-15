import { expect, it, vi } from 'vitest'
import { postJsonWithProgress, UploadError } from './uploadWithProgress'

type Plan = { progress?: number[]; result: 'ok' | 'error-before-sent' | 'error-after-sent' | number; text?: string }
function fakeXhr(plans: Plan[]) {
  const sent: string[] = []
  const make = () => {
    const plan = plans.shift()!
    const x: any = { upload: { onprogress: null }, onload: null, onerror: null, ontimeout: null, timeout: 0, status: 0, responseText: '', open: vi.fn(), setRequestHeader: vi.fn(), abort: vi.fn(),
      send(body: string) {
        sent.push(body)
        queueMicrotask(() => {
          for (const p of plan.progress || []) x.upload.onprogress?.({ lengthComputable: true, loaded: p, total: 100 })
          if (plan.result === 'error-before-sent' || plan.result === 'error-after-sent') return x.onerror()
          x.status = plan.result === 'ok' ? 200 : plan.result; x.responseText = plan.text ?? '{"documentId":"d1"}'; x.onload()
        })
      } }
    return x
  }
  return { make, sent }
}

it('reports real upload progress and returns the JSON response', async () => {
  const f = fakeXhr([{ progress: [25, 50, 100], result: 'ok' }]); const seen: number[] = []
  const r = await postJsonWithProgress<{ documentId: string }>('/api/upload-document', { a: 1 }, { Authorization: 'Bearer t' }, p => seen.push(p), f.make)
  expect(r.documentId).toBe('d1'); expect(seen).toEqual([0.25, 0.5, 1]); expect(JSON.parse(f.sent[0])).toEqual({ a: 1 })
})
it('retries once when the connection drops BEFORE the body was fully sent', async () => {
  const f = fakeXhr([{ progress: [40], result: 'error-before-sent' }, { progress: [100], result: 'ok' }])
  await expect(postJsonWithProgress('/u', {}, {}, undefined, f.make)).resolves.toBeTruthy()
  expect(f.sent).toHaveLength(2)
})
it('never retries once the body was fully sent (server may have saved it — no duplicate documents)', async () => {
  const f = fakeXhr([{ progress: [100], result: 'error-after-sent' }, { result: 'ok' }])
  await expect(postJsonWithProgress('/u', {}, {}, undefined, f.make)).rejects.toBeInstanceOf(UploadError)
  expect(f.sent).toHaveLength(1)
})
it('does not retry server errors and explains 413', async () => {
  const f = fakeXhr([{ progress: [100], result: 413 }])
  await expect(postJsonWithProgress('/u', {}, {}, undefined, f.make)).rejects.toThrow(/too large/)
  expect(f.sent).toHaveLength(1)
})
