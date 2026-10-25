# Disposable staging renewal QA

Read-only readiness run 40187832315 attempt 2 succeeded after the owner saved the Test key: exact idogs-app-staging services and iDogs acct_1TiU0IGHgBd6ZgJE, Test subscription response, Singapore bucket. This proves read access only.

The new workflow uses a fresh nonce-scoped Stripe Test customer without an email/payment method, test product/price and two-day trial subscription that cancels if no payment method is supplied. No live resources, emails, real card numbers or tax settings are used. Staging fixture/profile creation is atomic. No Auth user or customer dog/file is created or deleted.

The operator-only staging billing adapter is not wired into a deployed HTTP route. It pins staging project, the iDogs Stripe account, Test key, exact run UID, disposable Firestore fixture and reciprocal Stripe customer metadata. Reverse customer ownership must resolve to that one fixture account. The existing request business logic calls the adapter on acceptance, which stops renewal via the reviewed Stripe SDK contract and writes a guarded revision/epoch result. QA reads back cancel_at_period_end and confirms cancelling the deletion request does not restart renewal.

Cleanup verifies nonce ownership before removing only the exact fixture documents/customer; cancels its test subscription and archives its price/product. Stripe may retain cancelled/archived test records; cleanup is not a claim that Stripe history is permanently erased. Cleanup failure fails the QA run. Raw keys, provider error text, customer IDs and fixture document contents are not printed. Runner interruption can still leave disposable test artifacts and requires operator reconciliation; concurrency never cancels an in-flight fixture job.

The dedicated Test key needs Accounts Read; Customers, Products, Prices and Subscriptions Write; Subscription schedules and Checkout Sessions Read for the existing adapter inventory. A read-only key correctly stops at the first denied write. Do not expand Live key permissions or use a Live key.

Passing this workflow verifies the staging renewal business-logic/SDK contract, not public HTTP authentication, signed webhook reconciliation, permanent deletion, confirmation email, client UX or App Store readiness. The cloud deletion worker remains unavailable. No automatic staging/production activation or Rules change is added.
