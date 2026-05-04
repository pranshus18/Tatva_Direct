# Partner Integration: Public Key (JWKS) – Baby Steps

This guide explains how to generate a **public/private keypair** and publish your **public key** so external partners (Porter or any delivery partner) can securely integrate with your platform—similar to how large platforms publish keys for verification.

You will end up with:
- A **private key** (kept secret on your server) used to **sign** tokens/requests
- A **public key** (safe to share) used by partners to **verify** signatures
- A plan to publish your public key as **JWKS** at a stable URL (recommended)

> Important: This file is documentation only. It does **not** change your code.

---

## 1) Decide what you’re signing (two common patterns)

Pick the one you need (many platforms do both):

- **A. Partners call your APIs**
  - You give partners credentials.
  - Partners call your API with a token.
  - Recommended: **OAuth2 Client Credentials** or **API Keys**.
  - If you still want a “public key” story: you can issue **JWT access tokens** signed by your private key; partners verify them (less common because the partner is the caller, not the verifier).

- **B. You call partners (webhooks / delivery creation / status updates)**
  - Your platform sends requests to partner systems.
  - Partners need to verify that the request really came from you.
  - Recommended: **JWT-signed requests** and publish your public key via **JWKS**.

If your goal is “**generate a public key to give other platforms**”, you most likely want **B** (signing your outbound requests / webhooks), plus a partner auth method for them calling you.

---

## 2) Baby steps: generate a keypair (RSA-2048)

Do this on your local machine **or** a secure admin machine.

### Step 2.1: Create a private key (keep secret)

```bash
mkdir -p keys && cd keys
openssl genrsa -out partner-signing-private.pem 2048
```

### Step 2.2: Derive the public key (safe to share)

```bash
openssl rsa -in partner-signing-private.pem -pubout -out partner-signing-public.pem
```

### Step 2.3: Verify you can read the public key

```bash
openssl rsa -pubin -in partner-signing-public.pem -text -noout
```

**Rules**
- Never commit `partner-signing-private.pem` to git.
- Store the private key in a secret manager (or at minimum an env var / protected file on server).
- You can share the public key with partners.

---

## 3) Assign a Key ID (“kid”) for rotation

Partners need a stable identifier so they know which key to use.

### Step 3.1: Create a kid (simple and practical)

Use a date-based id:
- `kid = "partner-signing-2026-04"`

Or a short random id:

```bash
node -e "console.log(require('crypto').randomBytes(8).toString('hex'))"
```

Write down your chosen `kid`.

---

## 4) Convert your public key to JWKS (recommended)

Most partners prefer a **JWKS URL** instead of a raw PEM file.

### Step 4.1: Install a converter tool (one-time)

```bash
npm i -g pem-jwk
```

### Step 4.2: Convert the public PEM → JWK

```bash
pem-jwk partner-signing-public.pem
```

This prints a JSON object containing fields like `kty`, `n`, `e` (RSA).

### Step 4.3: Wrap it as a JWKS document

Create `jwks.json` like this:

```json
{
  "keys": [
    {
      "kid": "partner-signing-2026-04",
      "use": "sig",
      "alg": "RS256",
      "kty": "RSA",
      "n": "...",
      "e": "AQAB"
    }
  ]
}
```

Notes:
- `alg` should match what you use to sign (RS256 is common).
- `kid` must match the id you chose in section 3.

---

## 5) Publish your public keys (JWKS endpoint)

Recommended URL pattern:
- `GET https://YOUR_DOMAIN/api/.well-known/jwks.json`

**Baby steps checklist**
- Host the JWKS JSON at a stable HTTPS URL
- Keep it highly available
- Allow caching (partners will cache it)
- When rotating, publish both old and new keys temporarily

If you can’t build an endpoint yet:
- You can temporarily email/share the `partner-signing-public.pem`
- But move to JWKS soon for professional integrations

---

## 6) What partners do with your public key

Partners use your public key to verify that a request/token was signed by you.

They typically:
1. Fetch JWKS from your URL
2. Find the key whose `kid` matches the incoming token header
3. Verify the JWT signature with that public key
4. Validate standard claims: `iss`, `aud`, `exp`, `iat`

---

## 7) How you sign outbound requests (recommended pattern)

When your platform calls a partner (e.g., create delivery, update status), include a signed JWT:

- **Header**: `Authorization: Bearer <JWT>`
  - or: `X-Tatva-Signature: <JWT>`

JWT should include:
- `iss`: your platform identifier (e.g. `tatva-direct`)
- `aud`: the partner name / id (e.g. `porter`)
- `exp`: short expiry (e.g., 5–10 minutes)
- `iat`: issued at
- `jti`: unique id for replay protection (optional but good)
- `partner_id`: if you manage multiple partners
- `request_hash`: hash of request body (optional but best practice)

**Why include `request_hash`**
- Prevents an attacker from copying a valid token and replaying it with a different body.

---

## 8) How partners authenticate to call your APIs (choose one)

This is separate from “public key”.

### Option 1: API Key (fastest)
- Give each partner a secret API key
- Partner sends: `Authorization: ApiKey <token>`
- You validate + rate limit + scope

### Option 2: OAuth2 Client Credentials (most standard)
- Partner gets `client_id` + `client_secret`
- Partner requests access token from your token endpoint
- Partner calls your APIs with `Authorization: Bearer <access_token>`

### Option 3: Mutual public keys (advanced)
- Partner signs their requests with *their* private key
- You verify using *their* public key
- More effort, strong security

---

## 9) Key rotation (must-have)

Plan rotation from day 1:

1. Generate a new keypair (repeat section 2)
2. Publish new key in JWKS **in addition** to the old key
3. Start signing new requests with the new key (`kid` changes)
4. Wait for partners to refresh cache (agree on timeline, e.g. 7–30 days)
5. Remove old key from JWKS

Emergency rotation (key compromise):
- Immediately add new key
- Immediately stop using old private key
- Notify partners to refresh JWKS ASAP

---

## 10) Partner onboarding checklist (practical)

Give the partner:
- **Base API URL** (prod + sandbox)
- **JWKS URL** (or public PEM as temporary fallback)
- **Expected headers** and signature method (JWT in header)
- **Scopes** they are allowed (deliveries, order read, etc.)
- **Webhook retry rules** and idempotency requirements
- **Support contact + SLA**

---

## 11) Quick “minimum viable” launch plan

If you want to ship in the simplest safe way:

1. Start with **API Key** for partner → your API calls
2. Add **JWKS + signed JWT** for your → partner webhooks/requests
3. Later upgrade partner auth to **OAuth2**

---

## Appendix: Common mistakes to avoid

- Don’t put the private key in the frontend.
- Don’t commit keys to git.
- Don’t use long-lived tokens without rotation.
- Don’t skip verifying `aud`/`iss`/`exp`.
- Don’t rely on product fields for inventory identity (use IDs)—relevant to your variant setup.

