# Repository Layer

This folder contains all database-access modules for the backend.

## Purpose

- Keep controllers focused on request/response handling.
- Keep services focused on business logic.
- Keep SQL/Supabase access in one predictable place.

## Naming Convention

- One domain per file, e.g. `ordersRepository.js`, `usersRepository.js`.
- Function names should describe query intent, not UI behavior:
  - `findOrderById`
  - `findUserBasicById`
  - `insertNotification`

## Usage

Import repository functions inside services/controllers instead of calling `supabase.from(...)` directly.

Example:

```js
import { findOrderById } from '../repositories/ordersRepository.js';
```

## Migration Strategy

For large controllers, migrate incrementally:

1. Extract repeated queries into repository functions.
2. Replace direct `supabase` calls with repository calls.
3. Keep behavior identical while refactoring.

## Team docs

- Backend standards: `backend/CONTRIBUTING.md`
- Post-refactor verification: `backend/SMOKE_TEST_CHECKLIST.md`

