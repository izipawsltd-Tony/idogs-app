# Owner-selected inbox QA gate

The real cloud deletion flow has verified Resend's simulation sink. That does not establish delivery to, or opening in, a human inbox. A guarded human confirmation adapter and tests are prepared, with an optional hook after completed Auth/data deletion in the controlled fixture runner. No human email has been sent.

Required owner input: select one email address and authorize one synthetic deletion QA confirmation to that inbox. Do not infer a recipient from customers, contacts or repository metadata. The owner must save that chosen address as GitHub Actions secret IDOGS_DELETION_QA_RECIPIENT_EMAIL, then authorize one QA message. The connected GitHub tools cannot write Actions secrets. No new API key is required. The prepared human-inbox workflow is skipped on normal commits and runs only on an explicit [human-email-qa] commit or manual dispatch. Runtime configuration uses IDOGS_DELETION_QA_RECIPIENT_EMAIL and the separate exact opt-in IDOGS_HUMAN_EMAIL_QA_APPROVAL=owner-selected-qa-inbox. The opt-in remains absent until the owner selects and authorizes the recipient. Existing dedicated Resend QA credentials are sufficient.

Subject: `iDogs QA: disposable account deletion completed`

Body: `This is an iDogs QA test. A disposable synthetic QA account and its test data have been deleted. Your own iDogs account has not been deleted. No action or payment is required.`

The sender refuses before the fixture job is completed, Auth is removed and all manifest records/live files are absent. The zero-retention QA runtime verifies its fixed isolated bucket. Stable provider idempotency plus a durable receipt prevents duplicate sending; a changed recipient is refused. Only the selected recipient is used and no recipient/key is printed in the report. Provider delivered evidence remains distinct from an owner confirming the inbox message was received/opened. Production email activation is not included.
