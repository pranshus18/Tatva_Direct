# Backend Contribution Guide

This backend uses a layered structure:

- `controllers` for HTTP request/response flow
- `services` for business logic
- `repositories` for database access

## Repository-first DB Rule

When adding or changing backend code:

1. Put database calls in `backend/repositories/*Repository.js`.
2. Keep controllers free from direct `supabase.from(...)` calls where practical.
3. Services should call repository functions for reusable DB operations.
4. Name repository functions by query intent (for example `findOrderById`, `insertNotifications`).

## What belongs where

- `controllers/*`
  - Validate input
  - Authorize user
  - Call service/repository layer
  - Return JSON response
- `services/*`
  - Orchestrate workflows
  - Apply business rules
  - Combine multiple repository calls
- `repositories/*`
  - Encapsulate table queries and DB writes
  - Keep query shape consistent and testable

## Refactor convention for existing files

For legacy large controllers, migrate in small safe steps:

1. Extract repeated DB calls into repository functions.
2. Replace old inline queries with repository imports.
3. Keep API behavior identical during refactor.
4. Run smoke checks for impacted endpoints.

## Quick checklist before merge

- No accidental behavior change in responses
- No new direct DB duplication added in controllers
- Lints pass for edited files
- Key endpoints manually smoke-tested

