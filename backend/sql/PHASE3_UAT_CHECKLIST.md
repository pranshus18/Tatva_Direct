# Phase 3 UAT Checklist (Portal Rollout)

## Service Provider portal
- Open an unpaid order and verify `Pay now (Razorpay)` appears.
- Complete Razorpay checkout and confirm order shows `paid`.
- Verify invoice and receipt links are present after payment.
- Trigger `Request bank transfer` fallback and verify pending transaction is created.

## Supplier portal
- Open supplier dashboard and verify settlement panel loads captured totals.
- Confirm order payment status reflects provider updates from payment transaction flow.

## Admin/Finance portal
- Run reconciliation from Admin Transactions page.
- Verify open reconciliation issues render and can be resolved/ignored.
- Verify risk signals load and can be marked reviewed/blocked/cleared.
- Verify audit logs show actions for payment intent, confirmation, issue updates, and risk reviews.

## Reliability jobs
- Run `npm run phase3-reliability-jobs`.
- Confirm stuck transaction retries are attempted.
- Confirm reconciliation run record and summary are created.

## KPI acceptance
- `GET /api/payments/metrics` shows:
  - `paymentSuccessRatePct`
  - `reconciliationSuccessRatePct`
  - `openHighSeverityIssues`
  - `webhookFailureCount`

Target:
- payment success + reconciliation >= 99%
- finance disputes traceable via audit + reconciliation issue trails
