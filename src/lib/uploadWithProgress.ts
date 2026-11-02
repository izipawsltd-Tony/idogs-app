// JSON POST with real upload progress (fetch has no upload-progress API) and
// one safe automatic retry. Retrying is only done when the request body was
// NOT fully sent (network dropped mid-upload, common on mobile/4G), so the
// server can never have processed it — no risk of a duplicate document.
export type ProgressFn = (fraction: number) => void

export class UploadError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'UploadError' }
}

type XhrLike = Pick<XMLHttpRequest, 'open' | 'setRequestHeader' | 'send' | 'abort' | 'status' | 'responseText'> & {
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  onload: (() => void) | null; onerror: (() => void) | null; ontimeout: (() => void) | null; timeout: number
}

function attempt(url: string, body: string, headers: Record<string, string>, onProgress: ProgressFn | undefined, make: () => XhrLike): Promise<{ status: number; text: string; fullySent: boolean }> {
  return new Promise(resolve => {
    const xhr = make()
    let fullySent = false
    xhr.open('POST', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.timeout = 120000
    xhr.upload.onprogress = e => {
      if (!e.lengthComputable) return
      if (e.loaded >= e.total) fullySent = true
      onProgress?.(Math.min(1, e.loaded / e.total))
    }
    xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText, fullySent: true })
    xhr.onerror = () => resolve({ status: 0, text: '', fullySent })
    xhr.ontimeout = () => resolve({ status: 0, text: '', fullySent })
    xhr.send(body)
  })
}

const defaultMake = () => new XMLHttpRequest() as unknown as XhrLike

export async function postJsonWithProgress<T = unknown>(
  url: string,
  payload: unknown,
  headers: Record<string, string>,
  onProgress?: ProgressFn,
  make: () => XhrLike = defaultMake,
): Promise<T> {
  const body = JSON.stringify(payload)
  const allHeaders = { 'Content-Type': 'application/json', ...headers }
  // Environments without XHR (unit tests, non-browser runtimes): plain fetch, no progress.
  if (typeof XMLHttpRequest === 'undefined' && make === defaultMake) {
    const res = await fetch(url, { method: 'POST', headers: allHeaders, body })
    if (!res.ok) throw new UploadError(res.status, res.status === 413 ? 'This file is too large to upload.' : 'Upload failed')
    onProgress?.(1)
    return await res.json() as T
  }
  let r = await attempt(url, body, allHeaders, onProgress, make)
  if (r.status === 0 && !r.fullySent) {
    onProgress?.(0)
    r = await attempt(url, body, allHeaders, onProgress, make)
  }
  if (r.status < 200 || r.status >= 300) throw new UploadError(r.status, r.status === 413 ? 'This file is too large to upload.' : 'Upload failed')
  try { return JSON.parse(r.text) as T } catch { return {} as T }
}
