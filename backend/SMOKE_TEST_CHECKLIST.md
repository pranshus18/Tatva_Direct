# Backend Smoke Test Checklist

Use this checklist after DB-layer refactors to verify core behavior quickly.

## 1) Start backend

- Run backend and ensure startup has no runtime errors.
- Confirm health/info endpoint responds.

## 2) BOQ flow

- Upload/normalize BOQ as service provider.
- Create product request from BOQ.
- Verify admin notifications are created for product request.

## 3) Dashboard flow

- Fetch service provider dashboard.
- Create a return request.
- Verify supplier and admin return notifications are created.
- Update payment status to `paid`.
- Verify receipt/invoice side effects still execute.

## 4) Supplier flow

- Add supplier product (new and existing catalog product paths).
- Edit supplier inventory/product details.
- Update order status (`processing`/`shipped`/`delivered`/`cancelled`).
- Verify buyer notification on status update.
- Verify return-status update notification to buyer.

## 5) Admin supply chain flow

- List brand/category definitions.
- Upsert a category supply chain definition.
- Fetch definition by name.
- Delete definition.

## 6) Profile/admin moderation notifications

- Update supplier profile with supply-chain changes.
- Verify admin notification for pending/review events.
- Approve and reject product in admin moderation routes.
- Verify supplier/service-provider notification delivery.

## 7) DB consistency checks

- Confirm entries created in `notifications` for all above actions.
- Confirm no duplicate unexpected rows for key writes.
- Confirm rollback paths still work (for example BOQ create with item insert failure).

## 8) Final sanity

- Re-run the same endpoint once more to catch idempotency issues.
- Check logs for unhandled promise or query errors.
- Confirm edited files have no linter errors.

