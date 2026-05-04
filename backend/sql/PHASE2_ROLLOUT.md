# Phase 2 Rollout Guide (B2B Core)

## 1) Apply migration

Run:

`backend/sql/migration_phase2_b2b_core.sql`

This adds reservation, warehouse allocation, lifecycle/SLA, returns policy, and vendor scorecard schema.

## 2) Enable feature flags in backend env

Use these flags from `backend/.env.example`:

- `PHASE2_CORE_ENABLED=true`
- `PHASE2_RESERVATION_ENABLED=true`
- `PHASE2_STATE_MACHINE_ENABLED=true`
- `PHASE2_RETURNS_POLICY_ENABLED=true`
- `PHASE2_VENDOR_SCORECARD_ENABLED=true`

Recommended staged rollout:

1. Enable only baseline KPIs and read endpoints.
2. Enable reservation endpoints for one supplier cohort.
3. Enable state machine transitions for one supplier cohort.
4. Enable returns policy engine.
5. Enable automated vendor scorecard refresh job.

## 3) Validate baseline metrics

Call:

- `GET /api/core-phase2/baseline-kpis`

Capture baseline before enabling mutating endpoints.

## 4) Load/smoke test

Set `PHASE2_TOKEN` and run:

`npm run phase2-load-test`

Track:

- success rate
- p95 latency
- error patterns in backend logs

## 5) Exit gate checks

- Oversell signal count trending down.
- SLA on-time percentage visible and improving.
- Partial returns with restock update inventory ledger correctly.
- Weekly vendor scorecards generated for target cohort.
