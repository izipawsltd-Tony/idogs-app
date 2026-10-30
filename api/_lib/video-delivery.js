import { pipeline } from 'node:stream/promises'
import { ApiError } from './http-helpers.js'

export function videoRange(header, size) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match || (!match[1] && !match[2])) return false
  const first = match[1] ? Number(match[1]) : null
  const last = match[2] ? Number(match[2]) : null
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return false
  const start = first === null ? Math.max(0, size - last) : first
  const end = first === null || last === null ? size - 1 : Math.min(last, size - 1)
  return start < 0 || start >= size || end < start ? false : { start, end }
}

// A stable video endpoint answers Safari's HEAD and byte-range GET requests
// directly. Bytes stream from private Storage, without buffering the movie
// in the Function or redirecting the player to an expiring signed URL.
export function createVideoDelivery(bucket) {
  return async (req, res, media, assertAccess) => {
    const file = bucket.file(media.path)
    let metadata
    try { [metadata] = await file.getMetadata() } catch { throw new ApiError(404, 'Media not found') }
    const size = Number(metadata.size)
    if (!Number.isSafeInteger(size) || size <= 0) throw new ApiError(404, 'Media not found')
    const mime = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }[media.path.split('.').at(-1)?.toLowerCase()]
    if (!mime) throw new ApiError(404, 'Media not found')
    await assertAccess()
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', mime)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.method === 'HEAD') {
      res.setHeader('Content-Length', String(size))
      return res.status(200).end()
    }
    const range = videoRange(req.headers.range, size)
    if (range === false) {
      res.setHeader('Content-Range', `bytes */${size}`)
      return res.status(416).end()
    }
    const start = range?.start || 0
    const end = range?.end ?? size - 1
    res.status(range ? 206 : 200)
    res.setHeader('Content-Length', String(end - start + 1))
    if (range) res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    const stream = file.createReadStream({ start, end })
    const close = () => { if (!res.writableFinished) stream.destroy() }
    res.once('close', close)
    try { await pipeline(stream, res) }
    catch {
      // Closing playback/seeking also closes the HTTP connection. Never log
      // raw provider errors or leak Storage paths/signatures to the player.
      if (!res.destroyed) res.destroy()
    } finally { res.off('close', close) }
  }
}
