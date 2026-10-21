# Agent runner pilot — setup draft

Queue: https://github.com/izipawsltd-Tony/idogs-app/issues/34

This is a separately scoped eve 0.81.1 scaffold. No running cloud service, schedule, watchdog, GitHub connection or model credential is installed by these files. Do not treat this draft as unattended-ready.

The scaffold was generated using `npx eve@latest init agent-runner-pilot --non-interactive`. Dependency installation/build are not yet verified. No paid infrastructure was provisioned.

Before activation: install and read bundled framework docs; implement least-privilege GitHub read access and read-only browser harness; durable queue/state/lease; external watchdog and stop switch; authenticated status access; configure model credential through secure setup; select host and concrete spend cap; verify one real turn, interrupted recovery, no-overlap and end-to-end public journey. Production operations remain forbidden.

Do not auto-deploy this subdirectory with the iDogs application. Use a separately linked runtime project when ready. Keep credentials, auth state, logs containing personal data and `.env*` out of Git.
