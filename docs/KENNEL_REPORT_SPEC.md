# Kennel records report v1 — implementation contract

The account's Full Kennel PDF and CSV export are read-only snapshots of stored
dogs, litters, linked vaccine/worming/health events and recorded transfers.
They are available to Plus users via the existing authenticated export endpoint.
No site-specific approval condition, physical occupancy, DACO sync or evidence
attachment is currently stored in a reliable kennel report data model. The
report must therefore always say **DRAFT — DATA REQUIRES REVIEW**. It must not
assert council compliance, count `active` as physically present, or claim that
the PDF includes the underlying certificates.

The PDF presents breeder identity, summary, review items, dog register, litter
relationships, transfers and health events. CSV uses named columns and stable
Firestore record IDs so duplicate names are unambiguous. Both outputs derive
from the same report model. Untrusted text is escaped in HTML and CSV formula
prefixes are neutralised. Existing single-dog, litter and breeding exports are
out of scope.

## Acceptance cases

- A duplicated chip, event before birth, next due before event, missing puppy
  link, incomplete litter and missing identity are listed as review items.
- Two dogs sharing a name remain separate by dog ID.
- Missing data is displayed as `Not recorded`; no date, certificate or
  compliance finding is invented.
- Requests still require Firebase ID token, matching tenant ID and Plus.
- No changes to Firestore Rules, Storage, Stripe, data or production config.

## Follow-on data model needed for a genuinely site-ready pack

Create an explicit facility profile and versioned approval conditions; a
timestamped dog/boarder arrival and departure ledger; daily care and incident
logs; breeder/DACO transfer evidence; immutable attachment manifest; reporting
period selection and reconciled daily/peak occupancy. Add capture UI and
verified source documents before enabling any owner-reviewed ready state.
These values cannot be reconstructed from the current `dogs.status` field.
