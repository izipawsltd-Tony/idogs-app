# Plus promotion UI — 2026-10-27

Owner confirms build 92 form, scan naming and Scan functionality PASS. The Plus web offer needed a clearer mobile layout.

The shared landing/Billing promotion now leads with A$0/month in a compact tinted panel. It shows the 31 January 2027 end date in Adelaide time and A$7/month from 1 February 2027 including GST, followed by payment-details, renewal/cancellation and SMS/extra-litter exclusions. Removed the large struck-through price and duplicate paragraph. The required unchecked opt-in directly acknowledges the displayed terms and post-promotion automatic renewal. Checkout promotion ID, acceptance payload, schedule, prices and native purchase gates are unchanged.

Validation: TypeScript and Vite build PASS. 437 Vitest checks PASS, including promotion dates, renewal terms, consent gating, exact Checkout request and campaign expiry; native Billing gates and promotion-tax preflight remain covered. Browser preview renders the real PlusPromotion component with app styles at 390px: no horizontal overflow; offer panel about 240px high. This is a local component preview, not Production publication.
