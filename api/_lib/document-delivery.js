import { pipeline } from 'node:stream/promises'
import { ApiError } from './http-helpers.js'
import { videoRange } from './video-delivery.js'
export function createDocumentDelivery(bucket) {
  return async (req, res, item, assertAccess) => {
    const file = bucket.file(item.path)
    let metadata
    try { [metadata] = await file.getMetadata() } catch { throw new ApiError(404, 'Document not found') }
    const size = Number(metadata.size)
    if (!Number.isSafeInteger(size) || size <= 0) throw new ApiError(404, 'Document not found')
    await assertAccess()
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Type', item.mime)
    res.setHeader('Content-Disposition', 'inline')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'")
    res.setHeader('Accept-Ranges', 'bytes')
    if (req.method === 'HEAD') { res.setHeader('Content-Length', String(size)); return res.status(200).end() }
    const range = videoRange(req.headers.range, size)
    if (range === false) { res.setHeader('Content-Range', `bytes */${size}`); return res.status(416).end() }
    const start = range?.start ?? 0, end = range?.end ?? size - 1
    res.status(range ? 206 : 200); res.setHeader('Content-Length', String(end - start + 1))
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    const stream = file.createReadStream({ start, end })
    const close = () => { if (!res.writableFinished) stream.destroy() }
    res.once('close', close)
    try { await pipeline(stream, res) } catch { if (!res.destroyed) res.destroy() } finally { res.off('close', close) }
  }
}
