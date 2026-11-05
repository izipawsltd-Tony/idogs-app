# Read-only Storage metadata fallback

The Cloud Browser again returned `Site Unavailable` for Google Cloud Storage. This is an access failure, not evidence of incorrect Firebase IAM or bot detection. Do not loosen IAM, disable security controls or change bucket retention to work around it.

`node scripts/qa/storage-metadata.mjs` offers an official Firebase Admin / Cloud Storage SDK alternative in an already authenticated operator environment. It uses Application Default Credentials, does not export or print credentials, and only calls the exact bucket's `getMetadata`. It never lists objects, reads customer file contents, changes policies or deletes data. It requires the fixed project `idogs-app`, bucket `idogs-app.firebasestorage.app`, and returned project number `404409556051`. Emulator and universe overrides are rejected.

The report allows only location, metadata revision and retention/versioning indicators. Omitted fields remain unknown rather than being interpreted as zero retention. It does not establish absence of exports or backups, object-level holds, media drain, restore replay or production deletion readiness. SDK errors are reduced to generic safe codes in CLI output.

This runner has no configured ADC file or service-account credential environment, so no live SDK read was attempted. Browser sign-in does not provide SDK credentials. An existing authenticated operator can run the command using their existing bucket-metadata read permission (`storage.buckets.get`); do not send service-account keys or tokens through chat or add broad project permissions for this task.

Validation: eight dependency-injected tests cover output privacy, unknown policies, explicit zero retention, wrong targets, wrong returned project identity, malformed fields, endpoint overrides and access errors. CI runs only these mocks with no cloud credentials. No runtime or iPhone UI behavior is changed, and no new TestFlight upload is triggered.
