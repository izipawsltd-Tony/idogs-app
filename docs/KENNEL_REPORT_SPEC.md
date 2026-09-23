# Kennel records report v1 — implementation contract

The account's Full Kennel PDF and Excel workbook export are read-only snapshots of stored
dogs, litters, linked vaccine/worming/health events, recorded transfers,
facility details, arrival/departure ledger and daily care logs.
They are available to Plus users via the existing authenticated export endpoint.
The facility section lets the owner enter approval identity, stated limits,
conditions and document reference. Movements are append-only (mistakes can be
voided with a reason); daily care is keyed by day. Occupancy is reconstructed
from ordered movements and reported for each Adelaide local day, including
peaks. The owner must attest the ledger started with recorded arrivals for
every dog then present. An unattested or incomplete ledger is highlighted;
its daily counts and peaks say `Not verifiable`, never a placeholder zero.
No DACO sync or evidence attachment is included. The report says
**DRAFT — DATA REQUIRES REVIEW** while issues remain, and **READY FOR OWNER
REVIEW** once the model finds none. It must not assert Council
compliance, count `active` as physically present, or claim underlying
certificates are attached.

The PDF presents breeder/facility identity, reporting period, daily occupancy,
care, review items, dog register, litter relationships, transfers and health
events. The primary spreadsheet is an `.xlsx` workbook with separate Read me,
Review items, Dog register, Litters and puppies, Health events, Transfers,
Daily occupancy, Movements and Daily care sheets. Visible labels use dog and
litter names. Source IDs remain in the model to reconcile duplicate names.
The register is historical account data; daily occupancy and care cover the
selected period. Both outputs derive from the same model. Untrusted text is
escaped in HTML and workbook XML, and workbook cells are strings rather than
formulas. The older kennel CSV endpoint remains for compatibility, but the UI
offers Excel. Existing single-dog, litter and breeding exports are out of scope.

## Acceptance cases

- A duplicated chip, event before birth, next due before event, missing puppy
  link, incomplete litter and missing identity are listed as review items.
- Two dogs sharing a name remain separate by dog ID.
- Missing data is displayed as `Not recorded`; no date, certificate or
  compliance finding is invented.
- Suspected QA/test names are flagged for owner classification, never silently
  excluded. Implausible birth years and invalid due dates are flagged.
- The PDF print window opens from the click gesture before asynchronous API work.
- Requests still require Firebase ID token, matching tenant ID and Plus.
- Facility writes require verified Firebase ID token and Plus. Movement writes
  verify the dog belongs to the authenticated tenant. Voids retain original
  event data; daily-log replacements retain revisions. No changes to Firestore
  Rules, Storage, Stripe, or production config.

## Follow-on data model needed for a genuinely site-ready pack

Add verified source attachments and an immutable manifest, DACO transfer
evidence, versioned approval conditions with per-condition checks, a complete
initial roster reconciliation and owner sign-off.
An editable condition note and self-attested movement ledger are useful
records but cannot establish legal compliance on their own. Never enable a
Council-approved badge from the current `dogs.status` field or owner entries.
