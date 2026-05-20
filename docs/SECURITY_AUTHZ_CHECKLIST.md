# Authorization checklist (service-role backend)

Because the API uses the Supabase **service role**, **Postgres RLS does not protect you** for server-side queries. Authorization must be **explicit in route handlers**.

Use this checklist when adding or changing an endpoint:

1. **Actor** — Who can call it? (`requireAuthentication`, `requireAdminRole`, `requireServiceProvider`, supplier-only routes, etc.)
2. **Resource** — Which row(s) are touched? Always scope queries by `req.userId`, `service_provider_id`, `supplier_id`, or admin-only paths.
3. **Cross-tenant** — Confirm a normal user **cannot** substitute another user’s UUID in the path or body (negative test).
4. **Admin overrides** — If admins can act on behalf of others, log to `audit_log_entries` where you already use `writeAuditLog`.
5. **Finance / payments** — Double-check `requireFinanceRole` and order ownership before creating or confirming payments.

Review at least once per release for:

- `/api/payments/*`
- `/api/po/*`
- `/api/orders*` (if any public or shared routes)
- `/api/supplier/*` mutating catalog or pricing
- `/api/admin/*`
