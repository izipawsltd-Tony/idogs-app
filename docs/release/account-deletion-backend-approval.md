# Backend-only account deletion request candidate

Base: production SHA ee3a4089ca6feb0a650fcf01d9aa9816530067f0, deployment dpl_GVNRvUc9JMiW7V4DnKwVaV6F71dQ. Vercel aliases idogs.com.au and www.idogs.com.au were verified on that deployment on 19 October 2026.

Branch: fix/account-deletion-backend-20261019. No production release or PR merge is authorized by preparing this branch.

## Exact scope

Four new server files provide authenticated request/status/cancel, an idempotent transactional lifecycle, a Super Admin read-only inventory/queue, and bounded inventory discovery. New requests atomically create one support conversation and message in the existing operator inbox. Cancellation closes the corresponding task. No email or SMS is sent.

This candidate does not include the diverged mobile branch, app UI changes, Firebase Rules/Storage/CORS/environment changes, Stripe calls, subscription changes, data cleanup or Auth deletion. It cannot permanently delete an account. The future processor must not run until ownership/media/provider inventory, legal retention, billing disposition and write freeze are verified.

## Validation

The prior seven-case emulator suite passed on mobile branch commit a1102c4ce95470f538e8d99a505f9e62e0814b73 (GitHub run 39198024248). The updated candidate runs 12 server safety tests and eight HTTP/Auth/Firestore/Rules integration cases on a synthetic demo project only, without production credentials. Inspect its exact-SHA CI/emulator and Vercel Preview results before deployment approval. A READY Preview is not authenticated browser E2E.

## Proposed owner-gated deployment

Deploy this backend-only exact SHA to the existing production project prj_UsnGhC1BWtYnmF5rKMYBR9KWkbIo in team team_oZF1Z0BUEceb9fAXdmFV1Saz, after verifying production still has the same base and required QA passes. Do not promote the full mobile branch. Roll back to the previously verified deployment if endpoint smoke tests fail. Never delete submitted requests as part of rollback.

After a separately approved production deployment, verify GET /api/account-deletion returns 401 without authentication, then use a disposable synthetic account for request/read/cancel and verify one support task. Do not submit a deletion request for Tony's real account. Public App Store submission, PR merge and permanent deletion remain separate gates.
