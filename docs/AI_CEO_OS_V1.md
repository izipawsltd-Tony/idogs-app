# iDogs AI CEO OS — V1 Operating Contract

Status: Phase 1 / read-only decision kernel

## Purpose

AI CEO OS is the management layer for iDogs. Its job is to turn trusted operating data into a concise CEO brief, prioritised decisions, explicit authority lanes, measurable KPIs, and a repeatable learning loop.

The goal is not unconstrained automation. The goal is maximum useful automation while preserving customer trust, security, liquidity, legal/compliance obligations, and Tony's final approval rights.

## North Star

Grow sustainable iDogs enterprise value and recurring free cash flow.

## Decision Framework

Every material recommendation should follow six steps:

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
- KPI reporting;
- customer and funnel diagnosis;
- draft marketing and content;
- backlog prioritisation;
- experiment proposals;
- implementation briefs;
- Preview-safe implementation preparation;
- documentation and QA plans.

AUTO does not mean unrestricted external writes. Phase 1 remains read-only inside the application.

### TONY APPROVAL REQUIRED

AI CEO must not independently execute:

- production deployments or promotions;
- material new spend;
- banking, transfers, refunds, or movement of money;
- contracts or binding commitments;
- legal, tax, payroll, or regulatory submissions;
- material pricing changes;
- Stripe production changes;
- Firebase production Rules, environment, or destructive data changes;
- deletion of production data;
- irreversible or high-reputation-risk actions.

## V1 Technical Boundary

V1 is intentionally deterministic and read-only.

It may:

- authenticate through the existing Super Admin guard;
- read trusted iDogs user/subscription fields already used by the Super Admin dashboard;
- calculate operating indicators;
- create a CEO brief;
- create a prioritised decision queue;
- expose data gaps and approval gates.

It must not:

- call a model provider;
- add or require a new API key;
- perform external writes;
- query or modify live Stripe;
- modify Firebase Rules;
- modify environment variables;
- execute production changes;
- present estimated MRR as accounting truth.

## Trusted Data / Limitations

Current trusted dataset can support:

- total users;
- breeder / owner distribution;
- new users in 7 and 30 days;
- stored active paid subscriptions;
- estimated MRR from stored billing fields;
- Free / Plus entitlement distribution.

Current known gaps include:

- true visitor-to-signup funnel;
- activation events;
- cohort retention;
- churn history;
- acquisition channel attribution;
- live Stripe ledger truth;
- complete marketing spend / CAC.

The Control Center must label these as gaps rather than inventing precision.

## Release Guardrail

AI CEO OS follows the existing iDogs release discipline:

clean / exact SHA -> Preview -> QA -> separate approval for production.

No force push, rebase, or squash is required for this feature. Production remains a separate explicit approval gate.

## Phase Roadmap

### Phase 1 — Observe + Decide

- read-only Control Center;
- trusted KPI brief;
- deterministic decision queue;
- AUTO / APPROVAL lanes;
- visible data gaps.

### Phase 2 — Measure

- activation events;
- acquisition source / funnel metrics;
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
