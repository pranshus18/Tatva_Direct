# Voice ordering with Vapi or Retell AI — integration guide

This document describes how to add **voice-driven ordering** to the platform (e.g. speak to place an order instead of only using the UI). You can use **Vapi** or **Retell AI** as the voice layer; your existing Node APIs and Supabase logic stay the source of truth. The architecture is the same for both—only dashboard names, SDKs, and env vars differ.

## What you are building

Voice AI does three jobs: **listen → understand → act**. The “act” step means calling **your existing APIs** (for example PO creation via `POST /api/po/create` or POS offline orders), not replacing them.

**Vapi** and **Retell AI** are both strong options: they support **web and phone**, **function / custom tool calling** into your backend, and **STT + LLM + TTS** in one stack. Pick one, implement the flow once; if you change provider later, you mostly swap credentials, webhooks, and the client SDK—not your order logic.

### Vapi vs Retell AI (high level)

| Topic | Vapi | Retell AI |
|-------|------|-----------|
| Role | “Assistant” + tools | “Agent” + custom functions (same idea: your HTTP endpoints or inline tools) |
| Keys | API key (secret); optional **public** key for browser widget | API key (secret); follow their docs for web vs server usage |
| Typical flow | Configure assistant, attach tools, web SDK or phone | Configure agent, attach functions/webhooks, web or phone |
| When to lean here | Mature docs/SDK for voice agents; common choice for startups | Strong conversational agents; compare **latency and pricing** for your region |

You do **not** need both products in production—choose one unless you are explicitly running an A/B test.

---

## Baby steps (shared for Vapi and Retell)

### 1. Pick one flow first

Do not try to voice-enable everything on day one. Choose **one** path, for example:

- **Supplier POS** (walk-in sale), or  
- **Service provider PO** (`CreatePO` → `/api/po/create`)

Everything below assumes you mirror **that** manual flow.

### 2. Sign up and get keys

**Vapi**

1. Create a Vapi account.  
2. In the dashboard, create an **API key** (server-side only).  
3. Optionally create a **Public key** if you use their **web widget** in the browser (public keys are meant to be exposed in the frontend; **never** put the secret API key in React/env that ships to users).

**Retell AI**

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

- **Vapi** calls these **tools** (function calling).  
- **Retell** calls these **custom functions** (your webhook URL + payload schema).

Your Node server implements the **real** Supabase/order logic; the voice provider only sends structured arguments.

### 4. Add a small “voice bridge” on your backend (recommended)

Do **not** paste your user’s long-lived JWT into either dashboard.

Instead:

1. User logs in to your app as usual.  
2. Your backend creates a **short-lived voice session token** (e.g. 15 minutes) tied to `userId`.  
3. The frontend starts the voice session (Vapi or Retell SDK) after login, passing context via your backend if needed.  
4. When the provider invokes a **tool/function**, it hits **your** endpoint, e.g. `POST /api/voice/tool`, which validates the session token and then calls the same controller logic as the manual flow.

That way voice and manual orders share one implementation. The bridge code is **the same** for Vapi and Retell; only request signing, headers, or payload shape may differ—normalize inside one route.

### 5. Configure the assistant / agent

**Vapi**

1. Create an **Assistant** with system instructions (role, language, “always confirm totals before placing order”).  
2. Register **tools** (name, description, JSON schema).  
3. Point tool **server URL** / webhooks to your deployed backend (HTTPS).  
4. Test in the **Playground**: speak → see tool calls → see your server logs.

**Retell AI**

1. Create an **Agent** with prompt / knowledge as needed.  
2. Add **custom functions** that map to the same HTTP endpoints and schemas you would use for Vapi tools.  
3. Connect **web** or **phone** per their wizard; test in their preview / dashboard.  
4. Confirm each function hits your server and returns JSON the agent can read back to the user.

### 6. Wire the client

- **Vapi — Web**: Web SDK or embed widget on the order page; start a call after login.  
- **Vapi — Phone**: Phone number feature for dial-in ordering.  
- **Retell — Web / Phone**: Use their documented Web Call / phone flow; start sessions with your API key on the server and pass tokens to the client as they recommend.

### 7. Safety and UX (both platforms)

- **Confirm before submit**: Assistant must read back items, quantities, and total; user says “yes” → then call “place order”.  
- **Idempotency**: If you already use `client_order_id` or similar for POS, reuse it for voice so retries don’t double orders.  
- **Secrets**: Store `VAPI_API_KEY` or `RETELL_API_KEY` only in server `.env` or hosting secrets; secure tool endpoints with your session token or a dedicated server-to-server secret.

---

## Other alternatives (if you outgrow bundled providers)

| Option                        | When it fits                                              |
|-------------------------------|-----------------------------------------------------------|
| **Vapi**                      | All-in-one voice agent + tools + phone.                   |
| **Retell AI**                 | All-in-one agent + custom functions + phone/web.          |
| **OpenAI Realtime API**       | More DIY; you build session + tools yourself.            |
| **Twilio + STT + LLM + TTS**  | Maximum control, more glue code.                          |

For **baby steps** and speed, starting with **Vapi or Retell** is reasonable—compare **cost per minute**, **latency** (especially for India), and **which dashboard** you prefer.

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
- **Provider**: Vapi vs Retell AI (pick one for v1).

Once those are fixed, you can define exact tool/function names, JSON schemas, and minimal `/api/voice/...` routes that wrap existing controllers.

---

## Vapi runbook for this repo (B2B PO)

### Required env vars

Backend (`backend/.env`):

- `VAPI_ASSISTANT_ID` — assistant id used by web calls
- `VAPI_PUBLIC_KEY` — safe to send to frontend for web SDK initialization
- `VAPI_WEBHOOK_SECRET` — shared secret checked on `/api/voice/vapi/tool`
- `VOICE_SESSION_SECRET` — optional; defaults to `JWT_SECRET` if not provided
- `VOICE_SESSION_TTL_SECONDS` — optional; defaults to `900`
- `INTERNAL_API_BASE_URL` — optional; defaults to `http://127.0.0.1:${PORT}`

### Exposed endpoints

- `POST /api/voice/vapi/session` (auth required, service_provider only)
  - Returns `voiceSessionToken`, `expiresAt`, `assistantId`, `publicKey`
- `POST /api/voice/vapi/tool` (Vapi webhook)
  - Expects `x-vapi-secret` header when `VAPI_WEBHOOK_SECRET` is set
  - Reads `metadata.voiceSessionToken` and dispatches tools

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

### Copy-paste system prompt (Vapi Assistant)

Paste into **Assistant → System prompt** (adjust tone if needed). Tool names must match your Vapi tool definitions exactly.

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
3. Verify Vapi call metadata contains `voiceSessionToken`.
4. Confirm tool calls hit `/api/voice/vapi/tool` and return `results`.
5. Run full path: discovery search -> add to cart -> supplier selection -> collect date/payment/shipping/billing -> review -> explicit confirm -> place.
