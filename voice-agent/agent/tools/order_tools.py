import json
import time
from typing import Any

from langchain_core.tools import tool

from integrations.tatva_api_client import TatvaApiClient


def _flatten_cart_items(draft: dict) -> list[dict]:
    items = []
    for g in draft.get("boqGroups") or []:
        for it in g.get("items") or []:
            items.append(it)
    return items


async def _auto_select_vendors(client: TatvaApiClient, items: list[dict]) -> dict[str, str]:
    body = {
        "items": items,
        "boqId": None,
        "_timestamp": int(time.time() * 1000),
        "_random": time.time(),
    }
    rank = await client.post("/api/vendors/rank", body)
    if not rank.get("ok"):
        return {}
    data = rank["data"]
    item_vendors = data.get("itemVendors") or data.get("vendors") or {}
    selected: dict[str, str] = {}
    for item in items:
        iid = str(item.get("id"))
        vendors = item_vendors.get(iid) or item_vendors.get(item.get("id")) or []
        if isinstance(vendors, list) and vendors:
            top = vendors[0]
            token = top.get("supplierProductId") or top.get("id") or top.get("vendorId")
            if token:
                key = str(item.get("productId") or iid)
                selected[iid] = str(token)
                if item.get("productId"):
                    selected[str(item["productId"])] = str(token)
    return selected


def build_order_tools(client: TatvaApiClient, memory):
    @tool
    async def track_order(order_id: str) -> str:
        """Track an order by order number or UUID."""
        oid = order_id.strip()
        result = await client.get(f"/api/dashboard/service-provider/orders/{oid}")
        if not result.get("ok"):
            dash = await client.get("/api/dashboard/service-provider")
            if dash.get("ok"):
                orders = (dash["data"].get("yourOrders") or dash["data"].get("orders") or [])[:5]
                return json.dumps({"hint": "Order not found", "recentOrders": orders})
            return f"Track failed: {result.get('error')}"
        return json.dumps(result["data"])

    @tool
    async def cancel_order(order_id: str, reason: str = "Cancelled via voice assistant") -> str:
        """Request order cancellation. Requires user confirmation before execution."""
        pending = {
            "type": "cancel_order",
            "summary": f"cancel order {order_id}",
            "payload": {"order_id": order_id, "reason": reason},
        }
        memory.set_pending_action(pending)
        return (
            f"I can cancel order {order_id}. "
            "Please confirm by saying yes, or say no to keep the order."
        )

    @tool
    async def reorder_products(order_id: str) -> str:
        """Re-add all items from a previous order to the cart."""
        detail = await client.get(f"/api/dashboard/service-provider/orders/{order_id.strip()}")
        if not detail.get("ok"):
            return f"Could not load order: {detail.get('error')}"
        order = detail["data"].get("order") or detail["data"]
        items = order.get("order_items") or order.get("items") or []
        added = 0
        for line in items:
            pid = (line.get("product") or {}).get("id") or line.get("product_id")
            if not pid:
                continue
            qty = int(line.get("quantity") or 1)
            res = await client.post("/api/po/cart/discovery-item", {"productId": pid, "quantity": qty})
            if res.get("ok"):
                added += 1
        return json.dumps({"status": "success", "added": added})

    @tool
    async def create_order(payment_method: str = "cod") -> str:
        """
        Start checkout from current cart. Requires confirmation before placing.
        payment_method: cod, online, bank_transfer, or credit.
        """
        cart_res = await client.get("/api/po/cart")
        if not cart_res.get("ok"):
            return f"Could not load cart: {cart_res.get('error')}"
        draft = (cart_res["data"].get("cart") or {}).get("draft") or {}
        items = _flatten_cart_items(draft)
        if not items:
            return "Your cart is empty. Add products before checkout."

        selected = memory.get_context("selected_vendors") or {}
        if not selected:
            selected = await _auto_select_vendors(client, items)
            memory.set_context("selected_vendors", selected)

        memory.set_pending_action(
            {
                "type": "place_order",
                "summary": "place your order",
                "payload": {
                    "items": items,
                    "selected_vendors": selected,
                    "payment_method": payment_method,
                },
            }
        )
        return (
            f"Ready to place order with {len(items)} items using {payment_method} payment. "
            "Say yes to confirm, or no to cancel."
        )

    async def execute_place_order(payload: dict) -> str:
        items = payload.get("items") or []
        selected = payload.get("selected_vendors") or {}
        payment_method = payload.get("payment_method") or "cod"

        group_res = await client.post(
            "/api/po/group",
            {"items": items, "selectedVendors": selected, "substitutions": []},
        )
        if not group_res.get("ok"):
            return f"Could not group order: {group_res.get('error')}"
        po_groups = group_res["data"].get("poGroups") or group_res["data"].get("groups") or []
        if not po_groups:
            return "No purchase order groups could be created. Ensure vendors are selected."

        create_res = await client.post(
            "/api/po/create",
            {
                "poGroups": po_groups,
                "paymentMethod": payment_method,
                "deliveryDestination": "shipping",
            },
        )
        if not create_res.get("ok"):
            return f"Order creation failed: {create_res.get('error')}"
        return json.dumps(create_res["data"])

    async def execute_cancel_order(payload: dict) -> str:
        oid = payload.get("order_id")
        reason = payload.get("reason") or "Voice cancellation"
        res = await client.post(f"/api/po/{oid}/cancel", {"reason": reason})
        if not res.get("ok"):
            return f"Cancel failed: {res.get('error')}"
        return json.dumps(res["data"])

    return {
        "tools": [track_order, cancel_order, reorder_products, create_order],
        "execute_place_order": execute_place_order,
        "execute_cancel_order": execute_cancel_order,
    }
