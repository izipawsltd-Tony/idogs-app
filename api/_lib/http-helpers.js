// api/_lib/http-helpers.js — shared request-parsing/error-response
// contract for every trusted server endpoint (Codex round 5, Blocker 9).
//
// Every endpoint used to do:
//   const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
// with the JSON.parse() call UNPROTECTED — a malformed JSON string threw
// synchronously and uncaught, surfacing as a raw 500 instead of a clean
// 400. And every catch-all handler did:
//   return res.status(500).json({ error: 'Internal error', message: err.message })
// which leaks the real internal error message (stack-adjacent detail,
// internal field/collection names, whatever the underlying exception
// happened to say) straight to the client. Both are fixed once, here,
// rather than per-endpoint.

// Thrown by a handler to short-circuit with a specific client-safe
// status + message (400/403/404/405/409 etc). Anything that reaches the
// generic catch-all WITHOUT being an ApiError is treated as unexpected
// and sanitized via sendInternalError below.
export class ApiError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

// Parses req.body into a plain object, tolerating both shapes Vercel's
// Node runtime can hand a function (already-parsed object when the
// content-type was recognized, or a raw string otherwise). Malformed
// JSON throws an ApiError(400) instead of letting JSON.parse's
// SyntaxError propagate uncaught.
export function parseJsonBody(req) {
  const raw = req.body
  if (raw && typeof raw === 'object') return raw
  if (raw === undefined || raw === null || raw === '') return {}
  if (typeof raw !== 'string') {
    throw new ApiError(400, 'Request body must be JSON')
  }
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError(400, 'Request body must be a JSON object')
    }
    return parsed
  } catch (err) {
    if (err instanceof ApiError) throw err
    throw new ApiError(400, 'Malformed JSON body')
  }
}

// Bounds how much text a client can push through any single string
// field in these endpoints (litter/heat-cycle notes, names, etc) —
// generous enough for genuine free-text notes, small enough that a
// pathological payload can't be used to bloat a document or the request
// itself. Schema modules (litter-schema.js, heat-cycle-schema.js) apply
// this per-field with their own tighter limits where appropriate (e.g.
// a name field doesn't need 10,000 characters).
export const MAX_STRING_LENGTH = 10000

// Standard handler wrapper: runs `fn(req, res)`, and turns any thrown
// ApiError into its declared status/message, and anything else into a
// sanitized 500 (full detail logged server-side via console.error,
// never echoed to the client).
export function withApiErrorHandling(context, fn) {
  return async function wrapped(req, res) {
    try {
      return await fn(req, res)
    } catch (err) {
      if (err instanceof ApiError) {
        return res.status(err.status).json({ error: err.message, ...err.extra })
      }
      console.error(`${context} error:`, err)
      return res.status(500).json({ error: 'Internal error' })
    }
  }
}
