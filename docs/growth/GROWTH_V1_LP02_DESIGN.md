# iDogs Growth V1 — LP-02 homepage design and copy (G1 review)

Status: **OWNER GATE G1, pending.** Copy direction approved by the Owner on 20 Nov 2026; final design still needs G1.
Tracker: #103 · Parent: #69 · Baseline: production `04f0f60` (PR #102 head)
Design canvas (desktop 1440 + mobile 390): https://claude.ai/artifact/6H7qe9AEFnaY51RWDSX9d7

## Section order (Project brief §5)
1. Hero: "Everything your dog needs, all in one place." / "Less paperwork. Less time searching. More time enjoying life with your dog."
   CTAs: **Get Started Free** → `/signup`, then **Download for iPhone** → `https://apps.apple.com/au/app/idogs/id6823094602`. Text link: "Breeding dogs? Explore iDogs for Breeders →" (`#for-breeders`).
2. Save time / Stay organised / Share easily
3. How iDogs works (3 steps)
4. Dog Owners (`#for-owners`, CTA → `/signup?role=owner`)
5. Breeders (`#for-breeders`, CTA → `/signup?role=breeder`)
6. Real product screenshot (dog profile)
7. Download iDogs for iPhone (`#iphone`)
8. Free + Plus pricing (`#pricing`): existing production offer logic only
9. Privacy and trust
10. FAQ (`#faq`), 7 questions with verified answers
11. Final CTA (Get Started Free + Download for iPhone)
Mobile: sticky bar showing Get Started Free + an iPhone icon button.

## Claim verification (production code @ 04f0f60)
| Claim | Source |
|---|---|
| Free: up to 2 dogs; Plus: up to 5 | `api/_lib/dog-cap.js` DOG_CAP |
| 2 iDogs Scans on Free (lifetime); 10/month on Plus | `api/_lib/entitlements.js` SCAN_QUOTA |
| Litters need Plus; 2 per rolling 12 months; extras A$39 | `api/_lib/litter-quota.js`, `src/lib/pricingCopy.ts` |
| Plus A$7/month incl. GST | `src/lib/pricingCopy.ts` |
| Annual A$70/year | `src/lib/pricingCopy.ts`. **Hidden pending Owner confirmation.** |
| Gift Voucher: 1 yr Plus, 100 places, ends 31 Dec, add a dog first, no renewal | `shared/access-grants.js`, `LaunchOfferCard` |
| A$0/month through 31 Jan 2027, then A$7 | `shared/plus-promotion.js`. Superseded for new customers while `LAUNCH_OFFER_ENABLED` (commit 02d653d). |
| SMS add-on +A$3/month, 20 credits | existing landing pricing |
| Email reminders, worming, health tests, documents, QR Passport limited view | SettingsPage, send-reminders, PassportPublicPage |
| Heat cycles, mating estimate, mating-due reminders | PR #102 (live) |
| Ownership transfer to new owner | TransferOwnershipModal, `/app/claim-dogs` |
| Minimum age 16, paid plans 18+ | PR #98 (live) |
| Ads only with consent | opt-in Meta Pixel (`metaPixel.ts`, Privacy s.8) |
| "Stored securely in Asia-Pacific" | CLAUDE.md legal rule |
| iPhone app: free, IZIPAWS PTY LTD, iOS 15+, no in-app purchases | App Store listing, checked 20 Nov 2026 |

No testimonials, stats or quantified time savings.

## Changes vs current production page (for LP-03)
- Headline, sub-copy and CTA wording changed as Owner-approved.
- New: iPhone section + App Store CTAs, Free pricing card, privacy section, FAQ.
- Removed: "AI"/Document Scan dark card, life-stage strip, "Less than the cost of a coffee", 🎁 emoji.
- Footer: adds the NN Global trademark line per CLAUDE.md and drops "© 2026" and "(Disclaimer pending legal review.)". **Owner to confirm.**
- Pricing render logic (`useOfferStatus`, `usePlusPromotion`, `promotionSuperseded`) reused unchanged.
