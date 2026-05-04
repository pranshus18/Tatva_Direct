# API Contract Coverage Matrix

This document tracks request-contract validation coverage using shared `zod` schemas and `parseWithSchema(...)`.

## Shared Validation Foundation

- `backend/utils/contractValidation.js`
- `backend/contracts/*.js`
- `zod` dependency in `backend/package.json`

## Covered Endpoints

### Auth (`backend/controllers/authController.js`)

- `POST /api/auth/signup` -> `signupSchema`
- `POST /api/auth/login` -> `loginSchema`
- `PATCH /api/auth/update-password` -> `updatePasswordSchema`

### PO (`backend/controllers/poController.js`)

- `POST /api/po/group` -> `poGroupRequestSchema`
- `POST /api/po/create` -> `poCreateRequestSchema`
- `PATCH /api/po/:id/self-serve` -> `poSelfServePatchSchema`
- `POST /api/po/:id/cancel` -> `poCancelSchema`

### Payments (`backend/controllers/paymentsController.js`)

- `POST /api/payments/orders/:id/razorpay/create` -> `paymentCreateSchema`
- `POST /api/payments/orders/:id/razorpay/confirm` -> `paymentConfirmSchema`
- `POST /api/payments/orders/:id/bank-transfer/mark` -> `bankTransferMarkSchema`
- `POST /api/payments/orders/:id/credit-line/approve` -> `creditLineApproveSchema`
- `POST /api/payments/orders/:id/bank-transfer/request` -> `bankTransferRequestSchema`
- `POST /api/payments/reconciliation/run` -> `reconciliationRunSchema`

### Phase2 (`backend/controllers/corePhase2Controller.js`)

- `POST /api/core-phase2/catalog/completeness/refresh` -> `catalogCompletenessRefreshSchema`
- `POST /api/core-phase2/catalog/duplicates/merge` -> `duplicateMergeSchema`
- `POST /api/core-phase2/inventory/reservations` -> `inventoryReservationSchema`
- `POST /api/core-phase2/orders/:id/transition` -> `orderTransitionSchema`
- `POST /api/core-phase2/returns/:id/policy-decision` -> `returnPolicyDecisionSchema`
- `POST /api/core-phase2/analytics/vendor-scorecards/refresh` -> `vendorScorecardsRefreshSchema`

### Vendors (`backend/controllers/vendorsController.js`)

- `POST /api/vendors/rank` -> `vendorRankSchema`

### Substitutions (`backend/controllers/substitutionsController.js`)

- `POST /api/substitutions/suggest` -> `substitutionSuggestSchema`

### BOQ (`backend/controllers/boqController.js`)

- `POST /api/boq/normalize` (body) -> `boqNormalizeBodySchema`
- `POST /api/boq/request-product` -> `boqRequestProductSchema`

### POS (`backend/controllers/posController.js`)

- `POST /api/pos/offline-order` -> `offlineOrderSchema`
- `POST /api/pos/offline-return` -> `offlineReturnSchema`

### Profile (`backend/controllers/profileController.js`)

- `PUT /api/profile` -> `profileUpdateSchema`
- `POST /api/profile/supplier/authorization-certificate` (body) -> `profileUploadCertificateBodySchema`

### Supplier (`backend/controllers/supplierController.js`)

- `PUT /api/supplier/bcov-levels` -> `supplierBcovLevelsUpsertSchema`
- `POST /api/supplier/bcov-levels/resolve-price` -> `supplierBcovResolvePriceSchema`
- `POST /api/supplier/upstream/orders` -> `supplierUpstreamOrdersSchema`
- `POST /api/supplier/inventory/adjust` -> `supplierInventoryAdjustSchema`
- `PATCH /api/supplier/returns/:id/status` -> `supplierReturnStatusPatchSchema`
- `PATCH /api/supplier/orders/:id/status` -> `supplierOrderStatusPatchSchema`
- `PATCH /api/supplier/notifications/:id/read` -> `supplierNotificationReadSchema`
- `PATCH /api/supplier/notifications/read-all` -> `supplierNotificationReadSchema`

### Dashboard (`backend/controllers/dashboardController.js`)

- `POST /api/dashboard/service-provider/orders/:id/returns` -> `createReturnRequestSchema`
- `PATCH /api/dashboard/service-provider/returns/:id/acknowledge-closure` -> `acknowledgeReturnClosureSchema`
- `PATCH /api/dashboard/service-provider/orders/:id/payment` -> `updateOrderPaymentSchema`

### Admin (`backend/controllers/adminController.js`)

- `PUT /api/admin/products/:id` -> `adminUpdateProductSchema`

## Pending Coverage (Recommended Next)

Targeted pending items from the previous pass are now covered:

- `backend/controllers/supplierController.js`
  - outlet create/update/repair-geo payloads
  - product create/update payload boundaries
  - AI enhance/extract/analyze payloads
- `backend/controllers/admin/*.js` route modules
  - product moderation reject + approve-all
  - brand request/reject + supply-chain reject flows
  - user management status updates
  - product workflow template/review payloads
  - admin AI enhance/GST payloads
- `backend/controllers/dashboard/orderDeletionRoutes.js`
  - delete-order request payload contract enforcement

Remaining recommended sweep:

- audit residual mutation routes that still use only inline validation and add domain contracts where missing

Additional sweep completed after this update:

- `backend/controllers/poController.js`
  - `POST /api/po/:id/rating` -> `poRatingSchema`
- `backend/controllers/paymentsController.js`
  - `PATCH /api/payments/reconciliation/issues/:id/resolve` -> `reconciliationIssueResolveSchema`
  - `PATCH /api/payments/risk/signals/:id/review` -> `riskSignalReviewSchema`
- `backend/controllers/corePhase2Controller.js`
  - `POST /api/phase2/inventory/reservations/:id/consume` -> `inventoryReservationConsumeSchema`
  - `POST /api/phase2/inventory/reservations/:id/release` -> `inventoryReservationReleaseSchema`
  - `POST /api/phase2/inventory/reservations/expire` -> `inventoryReservationExpireSchema`
- `backend/controllers/adminSupplyChainController.js`
  - `PUT /api/admin/supply-chain/definitions` -> `adminSupplyChainDefinitionUpsertSchema`
  - `POST /api/admin/supply-chain/suggest-gemini` -> `adminSupplyChainSuggestSchema`
- `backend/controllers/admin/productModerationRoutes.js`
  - `POST /api/admin/products/:id/approve` -> `adminProductApproveSchema`
  - `DELETE /api/admin/products/:id` -> `adminProductDeleteSchema`
- `backend/controllers/admin/brandAndSupplyChainRoutes.js`
  - `POST /api/admin/brands/:id/approve` -> `adminBrandApproveSchema`
  - `POST /api/admin/supplier-chain-requests/:id/approve` -> `adminSupplierChainApproveSchema`
- `backend/controllers/supplierController.js`
  - `DELETE /api/supplier/outlets/:id` -> `supplierOutletDeleteSchema`
  - `DELETE /api/supplier/products/:id` -> `supplierProductDeleteSchema`
- `backend/controllers/boqController.js`
  - `DELETE /api/boq/:id` -> `boqDeleteSchema`
- `backend/controllers/authController.js`
  - `POST /api/auth/logout` -> `logoutSchema`

## Contract Authoring Guidelines

- Keep one contract file per domain:
  - `contracts/authContracts.js`, `contracts/paymentContracts.js`, etc.
- Parse once at route boundary:
  - `const payload = parseWithSchema(mySchema, req.body || {})`
- Return `400` for `ZodError` via:
  - `getContractErrorMessage(error)`
- Keep business rules in services/controllers; keep contracts focused on shape/type/value ranges.

## Last Updated

- Date: 2026-04-27
- Scope: Core commerce + supplier/admin/dashboard critical write flows

