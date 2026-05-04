# Phase 3 Rollout Guide (Razorpay + Transaction Confidence)

## 1) Apply SQL migration

Run:

`backend/sql/migration_phase3_payments_confidence.sql`

This adds:
- payment transactions
- webhook event store
- reconciliation runs/issues
- risk signals
- immutable audit logs
- provider references on orders

## 2) Configure environment

Set in backend env:
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `RAZORPAY_WEBHOOK_SECRET`

## 3) Configure Razorpay webhook

Webhook URL:

`https://<your-backend-domain>/api/payments/webhook/razorpay`

Subscribe to at least:
- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `refund.processed`

## 4) API flow

1. Create intent:
   - `POST /api/payments/orders/:id/razorpay/create`
2. Client completes payment via Razorpay checkout.
3. Confirm payment:
   - `POST /api/payments/orders/:id/razorpay/confirm`
4. Webhook also updates provider truth and logs events.

Bank transfer + credit line:
- `POST /api/payments/orders/:id/bank-transfer/mark`
- `POST /api/payments/orders/:id/credit-line/approve`

## 5) Finance controls

- Run reconciliation:
  - `POST /api/payments/reconciliation/run`
- Review issues:
  - `GET /api/payments/reconciliation/issues`
- Settlement report:
  - `GET /api/payments/settlement/report`

## 6) Exit criteria checks

- Reconciliation success rate > 99%
- Open high-severity reconciliation issues = 0
- All payment changes have matching rows in `audit_log_entries`
