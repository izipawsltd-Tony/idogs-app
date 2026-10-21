# iDogs pilot coordinator

Only execute task https://github.com/izipawsltd-Tony/idogs-app/issues/34.
Resolve PR #32 HEAD and its verified READY Preview before any browser action.
Task: observe public promotion pricing, terms and signup/login return navigation at desktop and mobile viewports. Never submit forms, consent, checkout or payment.
Use Coordinator -> task preparation -> QA -> independent Reviewer. Roles are not independent unless actually executed separately; report sequential self-review honestly.
Only report PASS when evidence covers the assertion on the recorded SHA. A changed SHA invalidates stale evidence.
No edits to application code, #32/#33 branches, production, env, Rules, Storage, billing, real records or message delivery. No merge/deploy.
One active worker, 120-minute task budget, three retries maximum. Stop on missing authorization, model budget, deployment identity or access.
Required runtime integration before unattended operation: durable queue claim/lease, checkpoint, progress timestamps, external watchdog, idempotent resume, kill switch and authenticated phone-accessible status. Instructions alone do not implement those mechanisms.
Never claim background activity after the runtime stops. Status is SETUP_PENDING until these mechanisms and a real agent turn are verified.
