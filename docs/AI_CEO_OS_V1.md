# iDogs AI CEO OS — V1 Operating Contract

Status: V1.2 / read-only reality + decision kernel

## Purpose

AI CEO OS is the management layer for iDogs. Its job is to turn trusted operating data into a concise CEO brief, prioritised decisions, explicit authority lanes, measurable KPIs, and a repeatable learning loop.

The goal is not unconstrained automation. The goal is maximum useful automation while preserving customer trust, security, liquidity, legal/compliance obligations, and Tony's final approval rights.

## North Star

Grow sustainable iDogs enterprise value and recurring free cash flow.

## Decision Framework

Every material recommendation follows six steps:

1. FRAME — define the real problem, objective, constraints, deadline, and success metric.
2. EVIDENCE — separate FACT / ASSUMPTION / UNKNOWN and prefer trusted product data.
3. OPTIONS — compare conservative, balanced, aggressive, and do-nothing options where relevant.
4. ASYMMETRIC EVALUATION — weigh upside, downside, cost, speed, reversibility, strategic fit, probability, and opportunity cost.
5. DECIDE — produce one recommended decision and assign an authority lane.
6. EXECUTE / MEASURE / LEARN — convert the decision into owner, action, KPI, checkpoint, and keep/modify/kill/scale learning.

## Authority Lanes

### AUTO

AI CEO may perform or prepare reversible, low-risk work inside existing guardrails, including:

- research and analysis;
- read-only Stripe verification;
- KPI reporting;
- customer and funnel diagnosis;
- account-quality classification signals;
- draft marketing and content;
- backlog prioritisation;
- experiment proposals;
- implementation briefs;
- Preview-safe implementation preparation;
- documentation and QA plans.

AUTO does not mean unrestricted external writes. V1.2 remains read-only inside the application.

### TONY APPROVAL REQUIRED

AI CEO must not independently execute:

- production deployments or promotions;
- material new spend;
- banking, transfers, refunds, or movement of money;
- contracts or binding commitments;
- legal, tax, payroll, or regulatory submissions;
- material pricing changes;
- Stripe production writes;
- Firebase production Rules, environment, or destructive data changes;
- deletion of production data;
- irreversible or high-reputation-risk actions.

## V1.2 Technical Boundary

V1.2 is deterministic and read-only.

It may:

- authenticate through the existing Super Admin guard;
- read trusted iDogs Firestore operating collections;
- read Firebase Auth account emails for Super Admin-only classification;
- retrieve canonical Stripe Prices and stored Stripe Subscriptions using the existing `STRIPE_SECRET_KEY`;
- separate LIVE Stripe recurring revenue from TEST Stripe values;
- calculate operating indicators and account-quality signals;
- score decisions dynamically;
- produce a seven-day CEO action plan;
- expose data gaps and approval gates.

It must not:

- call a model provider;
- add or require a new API key;
- perform Stripe writes;
- perform Firestore/Auth writes;
- modify Firebase Rules;
- modify environment variables;
- execute production changes;
- count TEST Stripe subscriptions as business revenue;
- treat heuristic account classification as identity proof;
- present legacy estimated MRR as accounting truth.

## Revenue Truth

The V1.2 revenue hierarchy is:

1. LIVE Stripe recurring line items on retrieved active subscriptions — CEO revenue truth.
2. TEST Stripe recurring line items — QA signal only, never business revenue.
3. Stored subscription fields — reconciliation/diagnostic evidence.
4. Legacy Super Admin A$5/A$49 display catalogue — diagnostic only and never a decision source.

Canonical Plus price IDs are imported from the existing checkout contract. Stripe is queried read-only. If Stripe verification is partial or unavailable, the Control Center must say so and exclude unverified values from LIVE MRR.

## Account Classification

V1.2 classifies each account conservatively as:

- `INTERNAL` — Super Admin allowlist or valid internal entitlement;
- `TEST_QA` — explicit test/QA/staging/demo signals;
- `LIKELY_REAL` — active LIVE Stripe evidence or meaningful product activity with no internal/test signal;
- `UNCLASSIFIED` — insufficient evidence.

Every classification includes confidence and reason. `LIKELY_REAL` is a business-quality signal, not legal identity verification. Ambiguity must remain visible rather than being guessed away.

## Decision Scoring

V1.2 does not hard-code queue priority numbers. Candidate decisions are scored using:

`Impact × Urgency × Confidence × Reversibility ÷ Cost`

Inputs are normalized into a 0–100 score. The queue is sorted by score and urgency, then assigned a horizon:

- `NOW` — immediate operating risk/opportunity;
- `THIS_WEEK` — high-leverage near-term work;
- `NEXT_BUILD` — useful implementation after current operating work;
- `WATCH` — monitor without spending current focus.

The score is a transparent prioritisation aid, not a substitute for the six-step Decision Framework or Tony approval boundaries.

## Seven-Day CEO Action Plan

V1.2 turns current evidence into a seven-day operating cadence:

1. Revenue truth + account truth.
2. Clear support debt.
3. First-dog activation audit.
4. Litter + Plus conversion audit.
5. Minimum measurement contract.
6. Preview-only implementation and QA.
7. CEO weekly review: KEEP / MODIFY / KILL / SCALE and capital/time allocation.

Each day contains owner, authority lane, actions, KPI, success condition, and checkpoint.

## Minimum Measurement Contract

V1.2 deliberately avoids building a large analytics platform. The next measurement layer starts with six business events:

- `signup_completed`;
- `first_dog_created`;
- `first_litter_created`;
- `upgrade_started`;
- `subscription_activated`;
- `subscription_cancelled`.

Acquisition source is captured on signup; cancellation and subscription events must carry `livemode` so TEST activity cannot pollute business KPIs.

## Current Trusted Data / Limitations

The Control Center can currently use:

- users and roles;
- dogs and current ownership/commercial state;
- litters and active-litter state;
- support conversations;
- Showcase enquiries;
- Firebase Auth email evidence;
- stored subscription fields;
- read-only Stripe Prices and Subscriptions.

Known gaps still include:

- true visitor-to-signup traffic until acquisition analytics is connected;
- durable historical activation cohorts until the measurement contract accumulates data;
- durable churn/retention cohorts;
- complete marketing spend / CAC;
- historical puppy sales conversion from current-state Dog fields.

The Control Center must label gaps rather than invent precision.

## Release Guardrail

AI CEO OS follows the existing iDogs release discipline:

clean / exact SHA -> Preview -> QA -> separate approval for production.

No force push, rebase, or squash is required for this feature. Production remains a separate explicit approval gate.

## Phase Roadmap

### Phase 1 — Observe + Decide

- read-only Control Center;
- revenue/customer reality layer;
- deterministic decision queue;
- dynamic decision scoring;
- AUTO / APPROVAL lanes;
- seven-day CEO action plan;
- visible data gaps.

### Phase 2 — Measure

- minimum activation/acquisition events;
- cohort retention and churn;
- experiment result history;
- decision outcome history.

### Phase 3 — Reason

- approved model provider / AI Gateway;
- structured six-step decision output;
- evidence citations to internal metrics;
- confidence / unknowns;
- no direct high-risk execution.

### Phase 4 — Execute Reversible Work

- approved marketing/content workflows;
- task/agent routing;
- support and product operations within predefined scopes;
- automatic verification and audit trail.

### Phase 5 — Learning Loop

- expected vs actual outcome tracking;
- keep / modify / kill / scale decisions;
- policy improvement based on measured outcomes;
- cross-product CEO layer may later include IZIPAWS without mixing product architecture or data boundaries.
