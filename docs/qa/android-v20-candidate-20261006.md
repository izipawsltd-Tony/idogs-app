# Android v20 QA candidate — 2026-10-06

Based on the Play v19 source af0074918efd60d2c6d5516d840ba665aea146ef.

## Changes

- Native production public passport, transfer and showcase links use https://idogs.com.au; web Preview and dedicated native QA retain separate origins.
- Manual Documents upload uses the existing authenticated private /api/upload-document endpoint. It updates the server-created record, preserves title/notes, and never creates a duplicate document. Maximum file size is now 3 MiB to fit the base64 JSON API; original bytes are preserved.
- Native document View fetches the signed URL before opening the external browser; web keeps synchronous popup handling. Unsafe or missing URLs fail closed.
- Worming removes undefined optional fields before Firestore writes.
- Dog document rename controls wrap on small screens, with View/Delete on a separate row; global list shows saved names.

## Verification before packaging

- 115 Vitest tests passed (25 new regressions).
- 4 native production environment tests passed.
- TypeScript + Vite build passed; existing large-chunk warning remains.
- git diff --check passed.
- Local and Windows staged source trees matched before commit.

## Release gate

This is a candidate, not an Android Production approval. The four fixes require Android runtime rechecks after installation from Internal Testing: public QR, manual PNG/PDF upload and persistence, View from both lists, and worming with optional fields empty. Also recheck document rename after relaunch.

Remaining v19 gaps include valid medical Scan extraction, PetOwner/transfer runtime, offline behavior, delete/restore and physical-device coverage. No real transfer, billing payment, email or SMS is authorized by this QA run. Emulator functional suites may use isolated demo data only.
