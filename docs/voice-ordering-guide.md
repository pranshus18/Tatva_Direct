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
