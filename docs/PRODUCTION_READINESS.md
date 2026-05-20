# Production readiness roadmap

This document turns the platform hardening plan into **actionable work**. Items marked **Done in repo** reflect what is already implemented in code; the rest is your ongoing checklist.

## Phase 0 — Define targets

- [ ] Document expected peak traffic (concurrent users, orders per minute, largest uploads).
- [ ] Define RTO/RPO for outages and data loss tolerance.
- [ ] List compliance requirements (payments, invoices, personal data).

## Phase 1 — Safety and trust

### Authorization (API is the trust boundary)

The backend uses Supabase with the **service role key**, which **bypasses Row Level Security (RLS)**. Every route must enforce **who** can touch **which** resource.

- [ ] Maintain a route checklist: actor, resource, allowed action (see `docs/SECURITY_AUTHZ_CHECKLIST.md`).
- [ ] Add regression tests for IDOR-style bugs on **orders, payments, POs, invoices**.
- [ ] Optionally add **RLS** in Supabase for tables accessed with the **anon** key from clients; see `docs/SUPABASE_RLS_GUIDANCE.md`.

### Auth and sessions

- [ ] Prefer **short-lived JWTs** and refresh tokens when you extend session length.
- **Done in repo:** Throttle `users.last_login` updates (`LAST_LOGIN_UPDATE_INTERVAL_MS`, default 10 minutes) to reduce write load.
- **Done in repo:** `requireServiceProvider` / `requireAdminRole` skip an extra DB read when `req.user` is already loaded.

### Abuse limits

- **Done in repo:** Rate limits on `/api/auth/*` (`express-rate-limit`; tune with `RATE_LIMIT_AUTH_MAX`, `RATE_LIMIT_AUTH_WINDOW_MS`).
- **Done in repo:** High ceiling rate limit on payment webhook path (`RATE_LIMIT_WEBHOOK_MAX`, `RATE_LIMIT_WEBHOOK_WINDOW_MS`).
- [ ] Add stricter limits on AI/BOQ/upload endpoints when those URLs are identified.
- [ ] Set `RATE_LIMIT_DISABLED=true` only for local debugging (never in production).

**Environment variables (new / relevant)**

| Variable | Purpose |
|----------|---------|
| `TRUST_PROXY` | Default `true` in production when behind Render/nginx so client IP and rate limits are correct. Set `false` for pure local dev if needed. |
| `RATE_LIMIT_DISABLED` | Disables rate limits (default off). Also skipped when `NODE_ENV=test`. |
| `RATE_LIMIT_AUTH_MAX` | Max auth-route hits per IP per window (default 40). |
| `RATE_LIMIT_AUTH_WINDOW_MS` | Auth window in ms (default 15 minutes). |
| `RATE_LIMIT_WEBHOOK_MAX` | Max webhook posts per IP per minute (default 500). |
| `RATE_LIMIT_WEBHOOK_WINDOW_MS` | Webhook window in ms (default 1 minute). |
| `LAST_LOGIN_UPDATE_INTERVAL_MS` | Minimum gap between `last_login` writes per user (default 600000 = 10 min). |
| `RAZORPAY_HTTP_TIMEOUT_MS` | Timeout for Razorpay SDK calls (default 25000). |

### Payments and idempotency

- **Already present:** Razorpay webhook deduplication via unique constraint on `payment_webhook_events` (duplicate returns `{ status: 'ok', deduplicated: true }`).
- **Already present:** Payment transactions upsert on `provider,provider_payment_id`.
- [ ] Periodically review reconciliation and webhook failure metrics in admin tooling.

## Phase 2 — Reliability under load

- **Done in repo:** HTTP entry is split for safer deploys and future tests: `bootstrap/loadEnv.js` runs first; `app/createApp.js` builds the Express app without listening; `app/gracefulShutdown.js` owns SIGINT/SIGTERM; CORS lives in `config/cors.js`. Payments reuse `services/paymentTransactionService.js`, `utils/paymentNormalize.js`, and `controllers/payments/razorpayWebhookRouter.js` so webhook logic is not mixed with the main payment router.
- [ ] Indexes and pagination on all high-volume list endpoints.
- [ ] Transactions for inventory + order + payment state transitions.
- [ ] Background workers for AI, PDFs, large imports (queue + retries + dead letter).
- **Done in repo:** Timeouts around Razorpay `orders.create` and `payments.fetch` (504 mapping in `errorHandler` for `ETIMEDOUT`).
- [ ] Multi-instance: plan **sticky sessions** or **pub/sub** for WebSockets (`/api/voice/ws`).

## Phase 3 — Observability

- **Done in repo:** `X-Request-ID` on requests; `requestId` included in structured error logs and many JSON error responses.
- [ ] Ship logs to a hosted aggregator; add dashboards and alerts (5xx rate, latency, queue depth).
- [ ] Optional: enable `REQUEST_LOGS_ENABLED=true` in production only when debugging traffic (see `requestLogger.js`).

## Phase 4 — Quality and delivery

- [ ] Smoke E2E tests: login, critical purchase/PO flow, payment callback path in staging.
- [ ] Split oversized React pages into hooks + smaller components over time.
- [ ] Consider `/api/v1` versioning before publishing stable third-party integrations.

## Phase 5 — Scale (when metrics justify it)

- [ ] Horizontal scaling of the Node process behind a load balancer.
- [ ] Caching for safe read-heavy endpoints with explicit invalidation.
- [ ] Split only **proven** hot spots into separate services (e.g. voice gateway), not “microservices by default.”

---

Run automated checks from `backend/`:

```bash
npm test
npm run check:production
```
