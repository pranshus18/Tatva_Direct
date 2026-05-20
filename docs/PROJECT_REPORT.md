# AI Procurement Optimizer (Tatva)

**Project Report** — summary (private / shareable gist)

---

## What it is

**Tatva** is a B2B procurement-commerce platform aimed at construction and infrastructure-style supply chains. It takes buyers from requirements (e.g. BOQ) through vendor choice, ordering, fulfillment, and payment—with AI and voice where they add value, not as a generic retail storefront.

---

## Problem it targets

B2B buying is often manual: messy BOQs, spreadsheets for vendors, POs over email/phone. Retail e-commerce and heavy ERPs don’t fit mid-market, BOQ-first procurement well.

---

## Main goal

One system for the full path **requirement → PO → fulfillment → payment**, with roles for buyers, suppliers, service providers, and admins, plus AI for mapping, substitutions, and natural interaction.

---

## Who uses it

| Role | Focus |
|------|--------|
| **Buyer** | BOQ upload, discovery, cart, PO creation, orders, payments |
| **Supplier** | Catalog, outlets, pricing, fulfillment, buyer-facing analytics |
| **Service provider** | Logistics / returns-style ops alongside commerce |
| **Admin** | Supply chain, catalog guardrails, users, payments oversight, AI tooling |

Access is role-gated in the web app; each role lands on its own dashboard and route set.

---

## Typical flow (buyer)

BOQ normalize → vendor compare → substitutions (optional) → PO by vendor → order lifecycle → payment (online, bank transfer, or credit-line style options where enabled).

Voice can shortcut routine steps (search, cart, checkout) without replacing the full procurement UI.

---

## Capability areas (high level)

| Area | One-liner |
|------|-----------|
| **Procurement** | Normalize BOQ → pick vendors → substitutions → create PO; discovery, cart, orders |
| **Operations** | Inventory, order lifecycle, returns, vendor scorecards |
| **Payments** | Razorpay + B2B-style options, reconciliation, receipts, audit trail |
| **Catalog** | Controlled supplier onboarding, specs, completeness, duplicate handling |
| **AI / voice** | Catalog assist, fuzzy discovery, multi-provider AI fetch; WebSocket voice + RAG support docs |
| **Foundation** | React SPA, Express API, Supabase (Postgres), JWT auth, Zod request contracts |

---

## Stack (at a glance)

- **Frontend:** React, Vite, React Router — buyer/supplier/admin UIs and voice client
- **Backend:** Node.js, Express — REST under `/api`, feature flags, structured logging
- **Data:** Supabase / PostgreSQL — schema + SQL migrations in repo
- **AI:** OpenAI, Gemini, or Anthropic (config-driven; at least one key required for AI features)
- **Payments:** Razorpay (+ webhooks); reconciliation and invoice PDF services
- **Voice:** Dedicated voice module (intent routing, checkout flows, session memory, support RAG)

Not a monolith doc: see `README.md`, `backend/voice/README.md`, and `docs/API_CONTRACT_COVERAGE.md` for depth.

---

## Differentiators (short)

- **BOQ-first** — procurement path built around line items and vendor grouping, not SKU-only retail
- **AI where it helps** — mapping confidence, substitutions, product enrichment, voice navigation
- **B2B payments** — not card-only checkout; reconciliation and audit for finance teams
- **Multi-sided** — buyers and suppliers in one product, with admin control plane

---

## Positioning

Best fit: **mid-market B2B** procurement + supplier commerce (construction / infra supply chains).

Strong vs generic storefronts on procurement workflow; weaker today on enterprise integrations, compliance depth, and CI/release maturity (see `docs/COMPETITIVE_SCORECARD.md`).

---

## Why it matters (outcomes)

Faster BOQ-to-PO, fewer errors, better vendor and cost decisions, more reliable ops and finance, scalable supplier catalog, easier UX (including voice).

---

## Related docs (repo)

| Doc | Use when you need… |
|-----|-------------------|
| `README.md` | Local setup, core four-page procurement demo |
| `docs/API_CONTRACT_COVERAGE.md` | Which APIs have Zod validation |
| `docs/COMPETITIVE_SCORECARD.md` | Benchmark scores and 90-day targets |
| `docs/QA_TEST_SCRIPT.md` | Manual QA paths |
| `backend/SMOKE_TEST_CHECKLIST.md` | Pre-release smoke checks |

---

## Bottom line

Procurement-first platform that unifies sourcing, commerce, ops, payments, and light AI/voice—aimed at mid-market B2B, not a retail clone.
