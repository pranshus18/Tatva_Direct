# Competitive Scorecard (B2B Procurement-Commerce)

Last updated: 2026-03-27

## 1) Current Position Snapshot

This scorecard compares the platform against major ecommerce and procurement benchmarks on a 0-10 scale.

### Current Capability Scores

| Capability | Your Platform | Shopify | WooCommerce | Magento/Adobe Commerce | BigCommerce | Amazon/Flipkart Marketplace | Udaan/IndiaMART (B2B) | SAP Ariba/Coupa |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Multi-role workflows (buyer/supplier/admin) | 8.5 | 6.5 | 6.0 | 7.5 | 6.5 | 9.0 | 9.0 | 9.5 |
| Procurement flow (BOQ -> vendor select -> PO) | 9.0 | 2.5 | 3.0 | 4.5 | 3.0 | 6.0 | 8.5 | 9.5 |
| Catalog + supplier onboarding | 8.0 | 8.0 | 7.5 | 8.5 | 8.0 | 9.0 | 8.5 | 8.0 |
| Order + returns lifecycle | 7.5 | 8.5 | 7.5 | 8.5 | 8.5 | 9.5 | 8.0 | 9.0 |
| Inventory + reservations/allocation | 7.5 | 7.0 | 6.5 | 8.5 | 7.5 | 9.5 | 8.5 | 9.0 |
| Payments + reconciliation + audit | 8.0 | 8.5 | 7.0 | 8.0 | 8.5 | 9.5 | 8.0 | 9.5 |
| AI-enabled procurement assist | 8.5 | 6.0 | 5.0 | 6.5 | 6.0 | 8.0 | 7.0 | 7.0 |
| Analytics + admin control center | 7.5 | 8.0 | 6.5 | 8.5 | 8.0 | 9.0 | 8.0 | 9.5 |
| Integration ecosystem/apps | 4.0 | 10.0 | 8.5 | 9.0 | 9.0 | 10.0 | 7.0 | 10.0 |
| Security/compliance depth | 5.0 | 8.5 | 6.5 | 9.0 | 8.5 | 10.0 | 7.5 | 10.0 |
| Testing/CI/release maturity | 3.5 | 9.0 | 6.5 | 8.5 | 8.5 | 10.0 | 7.0 | 10.0 |
| Scalability/ops maturity | 5.5 | 9.0 | 6.5 | 8.5 | 8.5 | 10.0 | 8.0 | 10.0 |

## 2) Strategic Positioning

- Best fit today: Mid-market B2B procurement + supplier commerce.
- Strongest differentiator: BOQ-first procurement workflow and AI-assisted sourcing decisions.
- Biggest blockers vs top platforms: Integrations, quality automation, enterprise security/compliance.

## 3) 90-Day Target Score Plan

### Score Targets (Your Platform)

| Capability Cluster | Current | M1 Target | M2 Target | M3 Target |
|---|---:|---:|---:|---:|
| Core procurement workflow | 8.7 | 8.9 | 9.1 | 9.2 |
| Catalog/supplier operations | 7.8 | 8.0 | 8.2 | 8.4 |
| Payments/finance confidence | 8.0 | 8.3 | 8.5 | 8.7 |
| Integrations ecosystem | 4.0 | 5.2 | 6.2 | 7.0 |
| Testing + CI/CD | 3.5 | 5.5 | 6.8 | 7.8 |
| Security/compliance | 5.0 | 5.8 | 6.8 | 7.5 |
| Scalability/observability | 5.5 | 6.2 | 7.0 | 7.8 |

### Overall Platform Maturity Targets

| Metric | Current | M1 | M2 | M3 |
|---|---:|---:|---:|---:|
| Product completeness (launch quality) | 72% | 78% | 83% | 88% |
| Scale-up readiness | 55% | 63% | 71% | 80% |
| Enterprise readiness | 40% | 48% | 58% | 68% |

## 4) Sprint Deliverables

## Sprint P0 (Weeks 1-4): Foundation and Reliability

- Automated tests:
  - Add integration tests for top 15 backend APIs.
  - Add UI flow tests for 5 critical journeys (login, BOQ upload, vendor rank, PO create, payment confirm).
- CI/CD quality gates:
  - Lint + tests + build on every PR.
  - Migration validation in pipeline.
- Integrations starter:
  - Accounting export connector (Tally or Zoho Books).
  - Webhook/event export for key domain events.
- Observability baseline:
  - API latency dashboard (p50, p95, p99).
  - Error rate and payment failure alerting.

Expected impact:
- Testing/CI: +2.0 points
- Integrations: +1.0 to +1.5 points
- Ops maturity: +0.7 points

## Sprint P1 (Weeks 5-8): Control and Automation

- Approval matrix:
  - Role + amount + category-based approval chains.
- Security hardening:
  - Permission matrix audit and endpoint-level authorization checks.
  - Session/token policy tightening.
- Supplier performance automation:
  - SLA scorecards + periodic refresh jobs.
- Logistics connector:
  - One shipping partner API integration for dispatch visibility.

Expected impact:
- Security/compliance: +1.0 to +1.3 points
- Supplier operations: +0.4 to +0.7 points
- Marketplace competitiveness: +0.5 points

## Sprint P2 (Weeks 9-12): Enterprise Bridge

- ERP bridge:
  - Initial connector for one ERP/accounting sync workflow.
- Finance and credit:
  - Credit limit + approval + repayment tracking for B2B orders.
- Compliance readiness:
  - Audit evidence exports, access logs, policy traceability.
- SRE improvements:
  - Incident runbook, backup/restore drills, SLO definitions.

Expected impact:
- Enterprise readiness: +10 percentage points
- Integrations: +0.8 to +1.0 points
- Payments/finance confidence: +0.4 to +0.6 points

## 5) KPI Checkpoints (Track Weekly)

### Procurement and Fulfillment

- BOQ normalization accuracy (accepted match rate): target >= 92%
- Quote-to-PO conversion rate: target +15% from baseline
- PO cycle time (upload to PO issue): target -25%
- Stockout on ordered line items: target < 3%

### Payments and Finance

- Payment success rate: target >= 99%
- Reconciliation success rate: target >= 99%
- Open high-severity reconciliation issues: target 0
- Payment dispute resolution time: target < 48h

### Quality and Reliability

- Automated API test pass rate: target >= 98%
- Critical UI flow pass rate: target >= 98%
- Deployment success rate: target >= 95%
- p95 API latency: target < 500ms for core endpoints
- Error budget burn: within SLO budget

### Security and Compliance

- Unauthorized access incidents: target 0
- % endpoints mapped to explicit RBAC policy: target 100%
- Audit trail completeness for finance actions: target 100%

## 6) Competitive Goalposts by Month 3

- Vs Shopify/BigCommerce in B2B procurement use case: competitive advantage in workflow depth and AI-guided sourcing.
- Vs WooCommerce: stronger operational control and procurement intelligence.
- Vs Udaan/IndiaMART in product capability: near parity in workflow depth, while still behind on network effects.
- Vs Ariba/Coupa: credible mid-market alternative, not full enterprise parity yet.

## 7) Execution Ownership Template

Use this section to assign accountable owners.

| Workstream | Owner | Start | End | Status |
|---|---|---|---|---|
| API test suite |  |  |  | Not started |
| UI critical flow tests |  |  |  | Not started |
| CI/CD quality gates |  |  |  | Not started |
| Accounting integration |  |  |  | Not started |
| Observability dashboards |  |  |  | Not started |
| Approval matrix |  |  |  | Not started |
| RBAC hardening |  |  |  | Not started |
| Logistics connector |  |  |  | Not started |
| ERP bridge |  |  |  | Not started |
| Credit workflow |  |  |  | Not started |

## 8) Status Review Cadence

- Weekly: KPI review + blocker removal.
- Bi-weekly: score recalibration by capability cluster.
- Monthly: executive checkpoint against M1/M2/M3 target scores.

