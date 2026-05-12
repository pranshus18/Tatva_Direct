# Voice ordering with Retell AI — integration guide

This document describes how to add **voice-driven ordering** with **Retell AI** to the platform. Your existing Node APIs and Supabase logic remain the source of truth.

## What you are building

Voice AI does three jobs: **listen → understand → act**. The “act” step means calling **your existing APIs** (for example PO creation via `POST /api/po/create` or POS offline orders), not replacing them.

Retell supports **web and phone**, **custom function calling** into your backend, and **STT + LLM + TTS** in one stack.

---

## Baby steps (Retell)

### 1. Pick one flow first

Do not try to voice-enable everything on day one. Choose **one** path, for example:

- **Supplier POS** (walk-in sale), or  
- **Service provider PO** (`CreatePO` → `/api/po/create`)

Everything below assumes you mirror **that** manual flow.

### 2. Sign up and get keys

1. Create a Retell AI account.  
2. Create an **API key** from the dashboard (treat it like a secret—server-side or secure proxy only).  
3. Read their current docs for **web calling** vs **phone**: product names and SDK packages change; the pattern is still “authenticate → start session → agent speaks → functions hit your server.”

### 3. Model the manual steps as tools / functions

List what a human does today (e.g. select supplier, pick products, quantities, address, confirm). For each step, define a **function** the assistant can call, for example:

| Voice intent           | Backend action                                      |
|------------------------|-----------------------------------------------------|
| “Find cement 50kg”     | Search products (your existing search/list API)    |
| “Add 10 bags”          | Add line to a draft cart (you may need a small **draft order** concept or reuse BOQ) |
| “Place the order”      | Same payload your UI sends today (`/api/po/create` or POS endpoint) |

- **Retell** calls these **custom functions** (your webhook URL + payload schema).

Your Node server implements the **real** Supabase/order logic; the voice provider only sends structured arguments.

### 4. Add a small “voice bridge” on your backend (recommended)

Do **not** paste your user’s long-lived JWT into either dashboard.

Instead:

1. User logs in to your app as usual.  
2. Your backend creates a **short-lived voice session token** (e.g. 15 minutes) tied to `userId`.  
3. The frontend starts the voice session (Retell SDK) after login, passing context via your backend if needed.  
4. When the provider invokes a **tool/function**, it hits **your** endpoint, e.g. `POST /api/voice/tool`, which validates the session token and then calls the same controller logic as the manual flow.

That way voice and manual orders share one implementation.

### 5. Configure the agent

1. Create an **Agent** with prompt / knowledge as needed.  
2. Add **custom functions** that map to your backend HTTP endpoints and schemas.  
3. Connect **web** or **phone** per their wizard; test in their preview / dashboard.  
4. Confirm each function hits your server and returns JSON the agent can read back to the user.

### 6. Wire the client

- **Retell — Web / Phone**: Use their documented Web Call / phone flow; start sessions with your API key on the server and pass tokens to the client as they recommend.

### 7. Safety and UX

- **Confirm before submit**: Assistant must read back items, quantities, and total; user says “yes” → then call “place order”.  
- **Idempotency**: If you already use `client_order_id` or similar for POS, reuse it for voice so retries don’t double orders.  
- **Secrets**: Store `RETELL_API_KEY` only in server `.env` or hosting secrets; secure tool endpoints with your session token or a dedicated server-to-server secret.

---

## Other alternatives (if you outgrow bundled providers)

| Option                        | When it fits                                              |
|-------------------------------|-----------------------------------------------------------|
| **Retell AI**                 | All-in-one agent + custom functions + phone/web.          |
| **OpenAI Realtime API**       | More DIY; you build session + tools yourself.            |
| **Twilio + STT + LLM + TTS**  | Maximum control, more glue code.                          |

For **baby steps** and speed, Retell is a practical starting point. Compare **cost per minute** and **latency** for your region.

---

## Suggested implementation order

1. One user role + one order type (e.g. PO only).  
2. Read-only tool/function: **search products** (prove end-to-end).  
3. Write tool/function: **create draft / add lines**.  
4. Write tool/function: **submit order** (same as `CreatePO`).  
5. Polish prompts and confirmation.  
6. Add phone or second order type if needed.

---

## How this maps to this codebase

Order creation is already centralized in controllers (e.g. **PO** via `/api/po/create`, **POS** in `posController`). The voice layer should **call those same code paths** after validating a voice session—not duplicate SQL.

---

## Next decisions (for a tighter implementation plan)

- **Which flow first**: POS vs B2B PO.  
- **Channel**: Web only vs phone as well.  
- **Provider**: Retell AI.

Once those are fixed, you can define exact tool/function names, JSON schemas, and minimal `/api/voice/...` routes that wrap existing controllers.

---

## Retell runbook for this repo (B2B PO)

### Required env vars

Backend (`backend/.env`):

- `RETELL_API_KEY` — secret API key used server-side to create web calls
- `RETELL_AGENT_ID` — agent id used for web calls
- `RETELL_WEBHOOK_SECRET` — shared secret checked on `/api/voice/tool`
- `VOICE_SESSION_SECRET` — optional; defaults to `JWT_SECRET` if not provided
- `VOICE_SESSION_TTL_SECONDS` — optional; defaults to `900`
- `INTERNAL_API_BASE_URL` — optional; defaults to `http://127.0.0.1:${PORT}`

### Exposed endpoints

- `POST /api/voice/session` (auth required, service_provider only)
  - Returns `voiceSessionToken`, `expiresAt`, `agentId`, `retellAccessToken`, `retellCallId`
- `POST /api/voice/tool` (Retell webhook / tool bridge)
  - Expects `x-retell-secret` or `x-retell-signature` header when `RETELL_WEBHOOK_SECRET` is set

### Tool names expected by backend

- `search_products`
- `add_discovery_line`
- `get_po_cart`
- `list_suppliers_for_cart`
- `set_supplier_selections`
- `build_po_preview`
- `get_checkout_defaults`
- `place_purchase_orders`

### Assistant prompt guardrails

- Mandatory flow order: Product Discovery search -> add to cart -> supplier selection -> place-order details -> order review -> explicit confirmation -> place
- Always confirm selected items, suppliers, totals, and payment method before place
- Call `place_purchase_orders` only when user explicitly confirms
- Ask and capture all place-order fields before placement: `requiredDate`, `paymentMethod`, `shippingAddress`, `billingAddress`
- Enforce supplier picks strictly from Tatva platform-ranked supplier options per cart item
- If cart is empty, ask user to add products first
- **Product Discovery UI**: Each product has **Add to cart**; after adding, users open **Cart** from the app nav to pick suppliers and continue checkout (same cart as voice `add_discovery_line`).

### Copy-paste system prompt (Retell Agent)

Paste into **Agent → System prompt** (adjust tone if needed). Tool names must match your Retell function definitions exactly.

```text
You are Tatva’s voice ordering assistant for service providers (B2B purchase orders).

LANGUAGE AND TONE
- Default to clear, professional English unless the user speaks another language.
- Be concise; confirm critical facts before acting.

AUTHORITATIVE DATA
- Products, cart, suppliers, and orders come only from your tools—not from memory or the open web.
- Prefer platform-listed discovery products: always call search_products with the user’s words before insisting a product does not exist.

PRODUCT DISCOVERY (WEB)
- The app sends page context on voice start: searchQuery, selectedCategory, visibleProducts (current grid), and sometimes lastCartAddFromDiscovery after a recent UI add.
- When the user is on Product Discovery:
  1) Use search_products with their search terms (and category if they mention it).
  2) Read back short names (and brand if helpful) from the tool result or visibleProducts.
  3) To add by voice, call add_discovery_line with productId when known, else productName matching the listing they chose.
- If they use the screen instead: they tap **Add to cart** on a card; they can open **Cart** from the navigation when ready for supplier selection—use get_po_cart to confirm lines.

MANDATORY ORDER FLOW
1) Discovery: search_products → add_discovery_line (or confirm UI add via get_po_cart).
2) Cart / supplier selection: get_po_cart → list_suppliers_for_cart → set_supplier_selections with options from the tool only.
3) Checkout: get_checkout_defaults if helpful → collect requiredDate, paymentMethod, shippingAddress, billingAddress in natural language, then build_po_preview.
4) Read back preview totals and lines; only after explicit user confirmation (e.g. “yes, place it”), call place_purchase_orders with confirmed: true and the collected fields.

RULES
- Never call place_purchase_orders until the user explicitly confirms the final preview.
- If a tool returns an error or empty results, say so briefly and suggest refining the search or picking from on-screen results—do not invent products or prices.
- If the user says “the one I just added” or “that product,” use visibleProducts and lastCartAddFromDiscovery from context with add_discovery_line or get_po_cart as appropriate.
```

### Local testing checklist

1. Start backend and frontend.
2. Open Product Discovery or Cart and click **Start Voice**.
3. Verify Retell web call creation succeeds and frontend receives `retellAccessToken`.
4. Verify call metadata contains `voiceSessionToken`.
5. Confirm tool calls hit `/api/voice/tool` and return successful tool results.
6. Run full path: discovery search -> add to cart -> supplier selection -> collect date/payment/shipping/billing -> review -> explicit confirm -> place.
