# Supabase RLS and this backend

## Current model

The Node server uses `SUPABASE_SERVICE_ROLE_KEY`. The Supabase client created with that key **bypasses Row Level Security**.

That means:

- **Correctness and privacy depend on your Express routes** (see `docs/SECURITY_AUTHZ_CHECKLIST.md`).
- Turning on RLS on tables **does not change** behavior for requests that only go through this backend with the service role.

## When RLS still helps

1. **Direct browser access** — If you ever query Supabase from the frontend with the **anon** key, RLS is mandatory for user-scoped tables.
2. **Defense in depth** — If a key is misconfigured or a future service uses the anon key, RLS limits blast radius.

## How to adopt RLS safely

1. Enable RLS per table in a **staging** project first.
2. Add policies that match your **intended** access (e.g. `auth.uid() = user_id` for profile rows).
3. Keep the backend on the service role for batch jobs and complex joins, **or** move specific reads to the user JWT with narrow policies (larger refactor).

Do **not** copy-paste policies from examples without mapping every column and role to your real schema. Wrong RLS can lock out legitimate app flows or create a false sense of security if the app still uses only the service role.

## Related SQL

Your canonical schema and migrations live under `backend/sql/`. Add new migrations there and apply them in the Supabase SQL editor or your migration pipeline.
