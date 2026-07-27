# Transport group quotes — Tatva Direct integration

Logistics module endpoints for Tatva Direct after `POST /api/po/group` returns `groups[]`.

**Base URL:** `LOGISTICS_MODULE_URL` (e.g. `https://tatva-logistic-module.onrender.com` or `http://127.0.0.1:8001`)

---

## Endpoints

| Method | Path | Use |
|--------|------|-----|
| POST | `/api/logistics/quote-transport-group` | One group → merged quotes |
| POST | `/api/logistics/quote-transport-groups` | Multiple groups in one call |

Existing booking (unchanged):

| POST | `/api/logistics/book-courier-checkout` | Immediate Shiprocket book |
| POST | `/api/logistics/schedule-courier` | Deferred dispatch by expected dispatch date |
| POST | `/carrier/trucking-book` | Borzo intracity book |

---

## Request — single group

Send **one object** from your `groups[]` response (camelCase as today):

```http
POST /api/logistics/quote-transport-group
Content-Type: application/json
```

```json
{
  "vendorId": "88b2ad28-0120-4bcb-a0d2-99dc922bed62",
  "transportGroupId": "88b2ad28-0120-4bcb-a0d2-99dc922bed62::384, 9th main road...",
  "vendorName": "karthik",
  "total": 85,
  "pickupPincode": "411026",
  "pickupAddress": {
    "line1": "Pune",
    "city": "Pune",
    "state": "Maharashtra",
    "country": "India",
    "pincode": "411026"
  },
  "shippingAddress": {
    "line1": "384, 9th Main Road, HSR Layout",
    "city": "Bengaluru",
    "state": "Karnataka",
    "country": "India",
    "pincode": "560102"
  },
  "items": [
    {
      "name": "Mac Air M2",
      "quantity": 1,
      "price": 85,
      "specifications": { "Weight": "1.5 kg" }
    }
  ],
  "pickup_lat": null,
  "pickup_lng": null,
  "delivery_lat": null,
  "delivery_lng": null,
  "weight_kg": null
}
```

### Optional fields

| Field | Purpose |
|-------|---------|
| `pickup_lat`, `pickup_lng`, `delivery_lat`, `delivery_lng` | **Required for Borzo** intracity trucking quotes |
| `weight_kg` | Override when item specs have no weight (else parsed from `specifications.Weight` or 1 kg/item default) |
| `category` | Hint for trucking matter (auto-inferred from product names if omitted) |
| `correlation_id` | Your trace id (defaults to `transportGroupId`) |

### Batch

```json
{
  "groups": [ { "...": "same shape as above" }, { "...": "second vendor group" } ]
}
```

---

## Response (summary)

```json
{
  "success": true,
  "api_version": "2026.07-transport-group-quotes-v1",
  "transportGroupId": "...",
  "vendorId": "...",
  "lane": "intercity",
  "lane_reason": "distance_threshold",
  "distance_km": 842.5,
  "aggregated_weight_kg": 1.5,
  "modes_queried": ["courier"],
  "providers": [
    {
      "source": "shiprocket",
      "mode": "courier",
      "courier_company_id": 10,
      "name": "Delhivery Surface",
      "rate": 120,
      "etd": "3 Days",
      "transit_days": 3
    }
  ],
  "recommendations": [
    { "mode": "courier", "success": true, "providers": [] }
  ],
  "messages": [
    "Inter-city lane — Borzo (intracity trucking) is not offered. Shiprocket courier/LTL only."
  ],
  "booking_hints": {
    "client_reference": "...transportGroupId...",
    "courier_endpoint": "/api/logistics/book-courier-checkout",
    "schedule_endpoint": "/api/logistics/schedule-courier",
    "trucking_endpoint": "/carrier/trucking-book"
  }
}
```

---

## Routing rules (implemented)

| Condition | Quotes returned |
|-----------|-----------------|
| Same pickup + delivery pincode | **Intracity** — Shiprocket + Borzo (if lat/lng sent) |
| Road distance ≤ 50 km (config: `LOGISTICS_INTRACITY_MAX_KM`) | **Intracity** |
| Otherwise | **Intercity** — Shiprocket only (no Borzo) |

| Weight | Shiprocket |
|--------|------------|
| ≤ 30 kg | B2C parcel |
| 30–35 kg | B2C / heavy parcel |
| 35–150 kg | B2B / LTL (`is_b2b=1`) |
| > 150 kg | Attempt + error message |

Thresholds (defaults, overridable via env):

- `LOGISTICS_COURIER_MAX_WEIGHT_KG` = 30
- `LOGISTICS_TRUCKING_MIN_WEIGHT_KG` = 30
- `SHIPROCKET_PARCEL_MAX_WEIGHT_KG` = 35

---

## Tatva Direct flow

1. User completes project assignment on cart.
2. `POST /api/po/group` → `groups[]` (already grouped by vendor + delivery address).
3. **One transport UI block per group** → call `quote-transport-group` (or batch `quote-transport-groups`).
4. User picks a provider from `providers[]`.
5. Book:
   - Courier: `book-courier-checkout` or `schedule-courier` with `client_reference = transportGroupId`
   - Trucking: `carrier/trucking-book` with lat/lng

---

## Clubbing (reminder)

Logistics does **not** re-group. Tatva Direct must send one request per:

`vendorId` + `shippingAddressKey` + `pickupPincode`

Same supplier + same delivery + same pickup → one group (clubbed). Different vendors → separate calls (two buttons).
