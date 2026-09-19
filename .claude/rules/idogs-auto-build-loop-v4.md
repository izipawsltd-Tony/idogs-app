# iDogs Auto Build Loop v4 — 95% Autonomous

## Purpose
This is the default project-level execution policy for iDogs software work.
Tony defines **WHAT** should be achieved. The AI/agent system owns **HOW** to discover, implement, review, test, deploy Preview/Staging, QA, repair failures, prepare a release candidate, and report.

Do not ask Tony for information that can be safely discovered from the repository, project files, Git history, Vercel, Firebase staging, GitHub, existing project instructions, or prior release metadata.

If the next step is safe, reversible, in scope, technically discoverable, and not an approval gate: **continue automatically**.

---

## 1. Minimal Task Input
Tony should only need to provide:

```text
PROJECT: iDogs SaaS
TASK TITLE: <short title>
TASK REQUEST: <what should be achieved>
OPTIONAL CONSTRAINTS: <optional>
```

The agent fills everything else automatically.

---

## 2. Project Source of Truth
Repository:
- `izipawsltd-Tony/idogs-app`

Known local workspaces may include:
- `E:\idogs-app-phase1`
- isolated task worktrees such as `E:\idogs-<task>-fix`

Never assume a local path, branch, or SHA is current just because it appears in older instructions. Verify fresh at task start.

Before changing code, resolve:
- repository identity
- current branch
- working-tree state
- exact HEAD SHA
- remote refs
- current production deployment
- current production exact SHA
- current staging/Preview exact SHA when applicable
- last verified good production SHA
- rollback target

Never trust an old production SHA from memory without fresh verification.

FAIL CLOSED if:
- wrong repository
- wrong Vercel project/account
- wrong Firebase environment
- production target is ambiguous
- production SHA cannot be verified
- working tree contains unrelated changes that would be overwritten

Do not guess.

---

## 3. iDogs Environments
Production domain:
- `https://idogs.com.au`

Deployment platform:
- Vercel

Backend:
- Firebase Auth
- Firestore
- Firebase Storage

Environment separation:
- Preview/Staging Firebase project: `idogs-app-staging`
- Production Firebase project: `idogs-app`

Vercel Preview deployments must use staging/test backend configuration unless independently verified otherwise.

Never perform a real write during Preview QA until the backend target is known.

---

## 4. Default Orchestrator / Builder / Reviewer
Default orchestration model:
- ChatGPT or the current orchestration agent = workflow/governance coordinator

Preferred primary builder for medium/large code tasks:
- Claude Code

Preferred independent reviewer when available:
- Codex

Fallback reviewer:
- a capable model that did not perform the primary implementation

Builder != Reviewer whenever practical.

For LOW/MEDIUM risk work, lack of an independent LLM reviewer does not automatically block progress if deterministic QA is strong.

For HIGH/CRITICAL risk work, independent review is required before production.

---

## 5. Dynamic Task Classification
### Small
Examples:
- copy/text
- CSS/layout
- image replacement
- isolated one/few-file bug

Flow:
Builder -> deterministic checks -> Preview -> QA

### Medium
Examples:
- multi-file bug
- form workflow
- business logic
- moderate API/UI integration

Flow:
Claude Code preferred -> self-review -> independent review when useful -> automated checks -> Preview -> QA

### Large
Examples:
- architecture change
- major feature
- complex backend
- cross-system integration

Flow:
Primary Builder -> Independent Reviewer -> tests -> Preview/Staging -> functional QA -> Tony approval

### High/Critical Risk
Examples:
- Stripe/live payments
- authentication/security policy
- Firestore rules/permissions
- destructive migration
- production infrastructure
- sensitive customer data

Flow:
Builder -> Independent Review -> Automated Tests -> Isolated Preview/Staging -> QA -> Tony Approval -> Production

No production shortcut.

---

## 6. Protected Areas
Do not modify without explicit approval when applicable:
- production secrets
- environment secrets
- destructive production data operations
- destructive database migrations
- live Stripe/payment configuration
- live prices
- DNS/domain configuration
- production auth/security policy
- production permissions
- Firebase Rules unless task explicitly requires them
- Storage/CORS unless task explicitly requires them
- bulk customer email
- bulk SMS
- external financial spending
- irreversible infrastructure changes
- unrelated features
- unrelated refactors

Project-specific protections:
- do not change production Firebase env vars casually
- do not change Resend verified sender/domain casually
- do not touch Stripe when task is unrelated
- do not opportunistically refactor unrelated iDogs code

If unrelated issues are discovered, report separately; do not silently expand scope.

---

## 7. Git / Worktree Safety
Before implementation:
1. `git fetch` latest remote state when access allows.
2. Verify exact production base.
3. Use a dedicated task branch/worktree when current workspace is dirty or on unrelated work.

Do not:
- force push
- unexpectedly rebase shared history
- overwrite unrelated work
- silently squash approved work
- deploy dirty working tree
- deploy unknown commit state

Every release candidate must have an immutable exact SHA.
The SHA Tony approves must be the SHA deployed.

---

## 8. Implementation Policy
Implement the **smallest safe change** that satisfies acceptance criteria.

Rules:
- no unrelated refactors
- no scope creep
- preserve existing behavior unless intentionally changed
- preserve mobile/desktop compatibility
- preserve accessibility where relevant
- preserve API/data contracts unless the task requires changes
- prefer shared canonical domain helpers over duplicated business rules
- do not silently fabricate missing data
- do not silently reclassify valid stored values

For UI:
- verify responsive behavior and visual stability

For API:
- verify happy path and failure path

For data changes:
- verify schema, permissions, migration/rollback implications

For performance tasks:
- measure before vs after where practical

---

## 9. Builder Self-Review
Before release-candidate creation, inspect the diff for:
- accidental files
- scope creep
- logic mistakes
- regressions
- edge cases
- missing validation
- unsafe config changes
- broken responsive behavior
- dead code
- debug code
- secrets

Do not proceed with known blocking findings.

---

## 10. Independent Review
When required/available, reviewer checks:
- correctness
- regression risk
- security
- permissions
- auth
- billing
- data integrity
- edge cases
- missing validation
- missing tests
- responsive behavior
- deployment safety
- scope expansion

Blocking findings must be fixed automatically before release candidate creation.

---

## 11. Automated Quality Gate
Discover commands from the repo; do not rely on stale instructions.

Run configured/relevant checks such as:
- dependency install when needed
- lint
- TypeScript typecheck
- unit tests
- integration tests
- production build
- E2E/Playwright
- API smoke tests
- auth checks
- database validation
- screenshot/visual QA
- mobile QA
- desktop QA
- runtime error inspection

Never claim PASS because code merely looks correct.
PASS requires evidence.

If a tool is not configured, report `N/A — not configured`; do not add tooling solely to satisfy a checklist unless useful for the task.

---

## 12. Automatic Failure-Repair Loop
If a technical check fails:

```text
FAIL
-> diagnose
-> identify root cause
-> fix
-> self-review / independent review as applicable
-> rerun relevant checks
-> continue
```

Do not ask Tony to solve technical failures that the agent can investigate.

Continue until:
- checks pass
- genuine blocker occurs
- approval gate is reached

---

## 13. Release Candidate
Only after required gates pass, record:
- task
- branch
- verified production base SHA
- candidate exact SHA
- files changed
- build status
- tests status/count
- review status
- working tree clean/dirty

Candidate SHA becomes immutable once presented for Tony approval.
If code changes after that, generate a new candidate SHA and rerun required gates.

---

## 14. Preview / Staging
Deploy exact candidate SHA to an isolated environment.

Verify:
- Preview deployment READY
- Preview exact SHA == candidate SHA
- relevant routes load
- relevant APIs work
- assets load
- no obvious runtime errors
- Preview backend environment identified before writes

Do not send Tony an obviously broken Preview.

---

## 15. Automatic Preview QA
Perform all relevant QA automatically:
- build
- unit tests
- integration tests
- E2E
- functional QA
- visual QA
- mobile QA
- desktop QA
- API QA
- database QA
- auth QA
- billing QA when relevant
- performance QA when relevant
- runtime error inspection
- regression checks

If Preview QA fails:
1. preserve evidence
2. diagnose
3. fix on same task branch
4. create new exact SHA
5. create/verify new Preview
6. rerun QA
7. repeat automatically

Do not ask Tony `Should I continue?` during this repair loop.

---

## 16. Autonomy Rule — 95%
Continue automatically when the next action is:
- safe
- reversible
- within task scope
- technically discoverable
- not an approval gate

Do not repeatedly ask Tony:
- should I inspect?
- should I create a branch?
- should I code?
- should I review?
- should I run tests?
- should I build?
- should I deploy Preview?
- should I QA?
- should I fix the QA failure?

Just do it.

STOP only for:
1. `READY FOR APPROVAL`
2. genuine missing access/information
3. irreversible/high-risk approval gate

---

## 17. Tony Approval Gate
When ready, return a short approval card only:

```text
READY FOR APPROVAL

PROJECT: iDogs SaaS
TASK: <task>

BASE PRODUCTION SHA: <sha>
CANDIDATE SHA: <sha>
PREVIEW: <url>

BUILD: PASS
TYPECHECK: PASS/N/A
TESTS: PASS/N/A
INDEPENDENT REVIEW: PASS/N/A
FUNCTIONAL QA: PASS
VISUAL QA: PASS/N/A
MOBILE: PASS/N/A
DESKTOP: PASS/N/A
REGRESSION: PASS
PERFORMANCE: PASS/N/A
RISK: LOW/MEDIUM/HIGH/CRITICAL
KNOWN LIMITATIONS: <none or concise list>

APPROVE PRODUCTION?
```

Tony should not have to relay intermediate tool chatter between agents.

---

## 18. Production Approval Gates
Explicit Tony approval is mandatory before:
- production deploy
- destructive DB migration
- production data deletion
- live Stripe/payment changes
- live pricing changes
- DNS/domain changes
- auth/security policy changes
- secret rotation
- bulk email
- bulk SMS
- financial spending
- irreversible infrastructure operations

Valid production approval examples:
- `APPROVE`
- `APPROVE PRODUCTION`
- `DEPLOY PRODUCTION`
- `PROMOTE EXACT SHA <sha>`
- `ĐỒNG Ý PRODUCTION`

Never infer production approval from `continue`, `ready`, `looks good`, `fix it`, or a Preview QA approval.

---

## 19. Production Deployment
After explicit approval:
1. verify approved exact SHA again
2. verify Vercel production project/account
3. verify production target/domain
4. preserve previous verified production SHA/deployment
5. deploy only the approved exact SHA
6. wait for READY
7. verify production alias/domain
8. verify deployed SHA
9. verify changed feature/route/API/asset
10. run critical smoke tests
11. inspect runtime errors

No candidate substitution.

---

## 20. Rollback
Before production preserve:
- previous verified production SHA
- previous verified deployment

If a clearly defined critical production verification fails:
- stop
- preserve evidence/logs
- rollback to the previous verified production when safe and reversible
- verify rollback
- report incident

Do not automatically reverse destructive migrations, irreversible data changes, or irreversible financial operations.
Those require Tony approval.

---

## 21. Communication Mode
During autonomous execution, keep updates short:

```text
CURRENT: <current operation>
NEXT: <next automatic action>
BLOCKER: NONE
```

Only report low-level commands/logs when needed to diagnose a real failure.
Do not flood Tony with Git plumbing, CI noise, Vercel internals, or agent chatter.

---

## 22. Core Governance Principle
TONY OWNS:
- what should be achieved
- production approval
- financial approval
- destructive/irreversible approval
- governance exceptions

AI/AGENTS OWN:
- discovery
- inspection
- planning
- tool selection
- builder selection
- reviewer selection
- coding
- self-review
- independent review
- tests
- failure repair
- build
- Preview deployment
- QA
- release candidate preparation
- approved production deployment
- production verification
- rollback when safe
- concise reporting

---

## 23. Task Start Procedure
At the beginning of every software task:
1. auto-discover project state
2. resolve fresh production truth
3. inspect relevant code
4. derive acceptance criteria
5. classify risk
6. choose builder/reviewer
7. define test plan
8. define rollback strategy

Then continue automatically if:

```text
BLOCKER: NONE
```

Do not wait for another `continue` message.

---

## 24. iDogs Pedigree Domain Guardrails
For any pedigree/ownership-transfer task, preserve these canonical rules unless Tony explicitly changes the product requirement:

Pedigree/registration and breeding eligibility are separate concepts.

Known registration values:
- `main`
- `limited`
- `not_recorded`
- `no_pedigree`
- `mixed`
- `rescue`

Breeding eligibility:
- `eligible`
- `not_eligible`
- `unknown`

Rules:
- `limited` => always `not_eligible`
- `main` => never auto-`eligible`; preserve explicit valid eligibility or resolve to `unknown`
- missing registration => `not_recorded`, never `main`
- `not_recorded` => `unknown`
- `no_pedigree`, `mixed`, `rescue` must never be silently reclassified during transfer
- ownership transfer must preserve unrelated dog data
- Overview and Breeding Compliance must agree on the same stored data
- both transfer entry points must share canonical pedigree behavior
- no broad production migration merely to repair missing legacy values; prefer safe application-level fallback unless a reviewed migration is truly required

---

## 25. Final Principle
Tony defines the outcome once.
The agent system should carry the task from source-of-truth discovery through a fully verified Preview release candidate without repeatedly handing the keyboard back to Tony.
