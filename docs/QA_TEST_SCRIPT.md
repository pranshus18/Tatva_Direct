# Tatva Direct - End-to-End QA Test Script

This is a single, repeatable QA script for your full project.

Use it before each release.

---

## 1) Environment Setup

Run these in separate terminals:

### Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Automated Tests

```bash
cd backend && npm test
cd frontend && npm test
```

Expected:
- Backend tests all pass.
- Frontend tests all pass.
- No runtime crash in either dev server.

---

## 2) Pre-QA Data Checklist

Ensure you have:
- 1 admin user
- 1 service provider user
- 1 supplier user
- Supplier has approved products with stock
- At least one product category with searchable products
- Razorpay/test payment keys configured (if testing online payment)

---

## 3) Full Project QA Script (Run in Order)

## A. Auth & Access Control

1. Login as service provider.
2. Confirm redirect goes to service provider dashboard.
3. Logout and login as supplier, then admin.
4. Try opening admin route with non-admin user.

Expected:
- Role-based redirects and protected routes work.
- Unauthorized route access is blocked.

---

## B. Product Discovery & Search

1. Login as service provider.
2. Open `Product Discovery`.
3. Search by:
   - product name
   - brand
   - partial text
4. Apply category filter.
5. Clear search query and confirm discovery list appears.

Expected:
- Results load without errors.
- Category filter narrows results.
- Empty query still shows discoverable approved products.

---

## C. Checkout Flow (Create PO)

1. Go to BOQ normalize flow and create/select items.
2. Select vendors.
3. In `Create PO`, verify grouped vendors and totals.
4. Fill shipping/billing/delivery destination.
5. Choose payment method:
   - online
   - bank transfer
   - credit / cash (as needed)
6. Confirm and create PO.

Expected:
- POs are created successfully.
- Redirect to `Your Orders`.
- Order entries show correct amount, supplier, status.

---

## D. Post-Checkout Payment

For one unpaid order:

1. Open order details modal in `Your Orders`.
2. If online payment chosen:
   - click Razorpay payment
   - complete or simulate payment
3. If bank transfer path:
   - request bank transfer fallback
4. Download invoice/receipt where available.

Expected:
- Payment flow updates payment status correctly.
- Invoice/receipt links work.
- User gets clear payment status notices.

---

## E. Self-Serve Order Edit

Use an order in `pending` or `confirmed` and unpaid:

1. Open order details.
2. Click `Edit order`.
3. Update:
   - expected dispatch date
   - payment method
   - notes
   - delivery address fields
4. Save changes.

Expected:
- Save succeeds.
- Updated values appear after refresh/re-open.
- `status_history` gets a self-serve edit entry.

---

## F. Self-Serve Cancellation + Atomic Restock

Use an unpaid `pending/confirmed` order:

1. Open order details.
2. Enter cancellation reason.
3. Click `Cancel order`.
4. Refresh order and dashboard.

Expected (UI/API):
- Order status becomes `cancelled`.
- Cancellation reason persists in notes/history.

Expected (DB checks):
- One `cancel_restock` entry in `inventory_movements`.
- Stock for linked `supplier_products` is restored.
- Re-cancelling same order does **not** double-restock.

Suggested SQL checks:

```sql
-- Replace ORDER_ID with actual order uuid
select id, status, payment_status, notes
from orders
where id = 'ORDER_ID';

select id, reference_order_id, supplier_product_id, quantity_change, movement_type, notes, created_at
from inventory_movements
where reference_order_id = 'ORDER_ID'
order by created_at desc;
```

---

## G. Reviews & Ratings

1. Pick an order not yet delivered+paid.
2. Try to submit rating.
3. Mark order delivered and paid (via normal process/admin flow).
4. Submit rating + feedback.
5. Close/reopen order modal.

Expected:
- Rating blocked before delivered+paid.
- Rating accepted after delivered+paid.
- Existing rating loads when order is reopened.

---

## H. Non-Editable Lock UX

1. Open orders in these states:
   - paid
   - processing/shipped/delivered
2. Verify edit/cancel actions are unavailable.
3. Confirm lock reason badge text is shown.

Expected:
- User sees why action is locked.
- No editable actions available when business rules disallow it.

---

## I. Returns Flow

1. Open order with delivered items.
2. Create return request.
3. Validate quantity checks and reason requirement.
4. Acknowledge/close return from relevant role flow.

Expected:
- Return lifecycle transitions work.
- Returned quantities and order return list update correctly.

---

## J. Notifications

1. Trigger events:
   - new order creation
   - payment update
   - cancellation
2. Verify admin/supplier/service provider notification panels.
3. Mark notifications as read.

Expected:
- Notifications created for relevant users.
- Read/unread counts update correctly.

---

## K. Regression Spot Checks

1. Supplier dashboard loads.
2. Product management still works.
3. Vendor selection still returns ranked suppliers.
4. Admin pages load without new errors.
5. Receipt/invoice download still works.

Expected:
- No breakage in existing core workflows.

---

## 4) Test Scenario Matrix

Use this matrix for coverage tracking:

1. **AUTH-01** Valid login by role -> success redirect
2. **AUTH-02** Unauthorized route access -> blocked
3. **DISC-01** Search by product name -> relevant result
4. **DISC-02** Category filter -> filtered list
5. **DISC-03** Empty query -> discovery list
6. **CHK-01** Create PO with valid data -> orders created
7. **CHK-02** Missing shipping fields -> validation error
8. **PAY-01** Online payment success -> paid + invoice/receipt
9. **PAY-02** Bank transfer request -> pending verification message
10. **ORD-EDIT-01** Edit unpaid pending order -> saved
11. **ORD-EDIT-02** Edit paid/fulfilled order -> blocked + lock reason
12. **ORD-CAN-01** Cancel unpaid pending order -> cancelled
13. **ORD-CAN-02** Cancel paid/fulfilled order -> blocked
14. **ORD-CAN-03** Re-cancel same order -> no duplicate restock
15. **INV-01** Cancel restock movement written once
16. **INV-02** Supplier product stock restored correctly
17. **REV-01** Rate before delivered+paid -> blocked
18. **REV-02** Rate after delivered+paid -> success + persists
19. **RET-01** Create return with valid quantity -> success
20. **RET-02** Return quantity > ordered -> blocked
21. **NOTIF-01** Order/payment/cancel notifications -> visible
22. **REG-01** Vendor ranking flow unaffected
23. **REG-02** Product management unaffected
24. **REG-03** Admin views unaffected

---

## 5) Release Sign-off Criteria

Mark release as QA-pass only if all are true:
- Automated tests pass (backend + frontend)
- No P1/P2 defect open
- Checkout, cancel, edit, payment, rating flows pass
- Atomic cancel + restock verified in DB
- No duplicate restock entries on repeated cancellation attempts

