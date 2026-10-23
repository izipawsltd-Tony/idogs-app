# Promotion compatibility — 23 October 2026

Owner supplied landing and Billing screenshots as the campaign contract:
- Plus A$0/month through 31 January 2027 Adelaide time; A$7/month including GST from 1 February 2027.
- Payment details and explicit consent required; automatic renewal unless cancelled.
- SMS is an optional A$3/month add-on with 20 credits per billing month; excluded from the Plus promotion.
- Two litters per rolling 12 months included; extra litters A$39 each and excluded from the promotion.
- Monthly offer only; annual selection must not imply the monthly offer applies.

An existing staging subscription opens in Stripe Test portal with legacy $5/month and USD presentment. Its trial end matches the campaign date, but that alone is not proof of campaign enrolment. Do not rewrite that subscription, create a duplicate, or assume the live campaign is broken from that fixture.

This change reports campaign confirmation only from server-retrieved subscription identity, campaign consent metadata, correct mode-specific AUD700 inclusive monthly price, automatic tax and the approved trial end/anchor. Billing distinguishes an ordinary trial from confirmed campaign enrolment. No Stripe mutation, customer migration, price change, entitlement grant, env/Rules change or production release is included.

Current isolated checkout policy permits promotional test checkout only in the dedicated staging Vercel project. A Preview of the production project must not be widened to perform campaign checkout as a side effect of this display fix. Fresh synthetic Checkout → signed webhook → persisted entitlement and A$7 pricing still need end-to-end verification on the approved dedicated staging environment. Unit tests are not that verification.
