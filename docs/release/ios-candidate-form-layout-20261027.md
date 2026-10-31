# iOS candidate: add-dog layout and scan naming — 2026-10-27

Owner reports scanning PASS on build 91. This supersedes the prior immediate-tab crash gate for that tested flow. Owner screenshots IMG_7982–7984 show the add-dog form's two-column layout truncating registry labels/identifiers, iOS date control overlapping the colour field, and the save/Scan more action row overflowing.

Changes: use bounded grid tracks on desktop, one column below 600px, narrower mobile page/card padding, bounded controls and stacked wrapping actions. Submit locks, validation, scan consent and record creation are unchanged. Rename displayed AI Document Scans / AI Scans in plan, settings, terms, remaining quota and API quota messages to iDogs Document Scans / iDogs Scans. Preserve explicit AI/Anthropic consent and privacy disclosures.

Verification: TypeScript, Vite build and all 437 existing Vitest checks pass. Synthetic browser layout using actual app styles at 375px and 440px has one-column tracks and no input/select/button overflow. This is not physical iOS keyboard testing. Existing native billing restrictions are preserved; screenshots IMG_7980–7981 show the web offer with browser domain bar.

Candidate needs physical review of form layout in the new TestFlight build. No Production activation or App Review submission is performed by this change.

Additional scan quota validation initially exposed three stale July-period fixtures: the real reservation function correctly rolled them into the current month. Updated only those fixture boundaries to the current calculated billing period; quota enforcement and limits are unchanged.
