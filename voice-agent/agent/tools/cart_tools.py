import json
from typing import Any

from langchain_core.tools import tool

from integrations.tatva_api_client import TatvaApiClient


def _flatten_cart_items(draft: dict) -> list[dict]:
    items = []
    groups = draft.get("boqGroups") or draft.get("groups") or []
    if isinstance(draft.get("items"), list) and draft["items"]:
        groups = [{"items": draft["items"]}]
    for g in groups:
        for it in g.get("items") or []:
            items.append(it)
    return items


def build_cart_tools(client: TatvaApiClient, memory_setter=None):
    @tool
    async def get_cart() -> str:
        """Get the current shopping cart contents."""
        result = await client.get("/api/po/cart")
        if not result.get("ok"):
            return f"Could not load cart: {result.get('error')}"
        cart = result["data"].get("cart")
        if not cart:
            return json.dumps({"empty": True, "items": []})
        draft = cart.get("draft") or {}
        items = _flatten_cart_items(draft)
        brief = [
            {
                "id": it.get("id"),
                "name": it.get("name") or it.get("normalizedName"),
                "quantity": it.get("quantity"),
                "productId": it.get("productId"),
            }
            for it in items
        ]
        if memory_setter:
            memory_setter("last_cart_items", brief)
        return json.dumps({"itemCount": len(brief), "items": brief})

    @tool
    async def add_to_cart(product_id: str, quantity: int = 1) -> str:
        """Add a product to the cart by product UUID."""
        result = await client.post(
            "/api/po/cart/discovery-item",
            {"productId": product_id, "quantity": max(1, int(quantity))},
        )
        if not result.get("ok"):
            return f"Add to cart failed: {result.get('error')}"
        return json.dumps(result["data"])

    @tool
    async def update_cart(item_id: str, quantity: int) -> str:
        """Update quantity for a cart line item."""
        result = await client.patch(
            f"/api/po/cart/items/{item_id}/quantity",
            {"quantity": max(1, int(quantity))},
        )
        if not result.get("ok"):
            return f"Update failed: {result.get('error')}"
        return json.dumps(result["data"])

    @tool
    async def remove_from_cart(item_id: str = "", clear_all: bool = False) -> str:
        """Remove one cart item by id, or clear entire cart when clear_all is true."""
        if clear_all:
            result = await client.delete("/api/po/cart")
            if not result.get("ok"):
                return f"Clear cart failed: {result.get('error')}"
            return json.dumps(result["data"])

        cart_res = await client.get("/api/po/cart")
        if not cart_res.get("ok"):
            return f"Could not load cart: {cart_res.get('error')}"
        draft = (cart_res["data"].get("cart") or {}).get("draft") or {}
        groups = list(draft.get("boqGroups") or [])
        found = False
        for g in groups:
            arr = g.get("items") or []
            new_items = [x for x in arr if str(x.get("id")) != str(item_id)]
            if len(new_items) != len(arr):
                found = True
                g["items"] = new_items
        if not found:
            return "Cart item not found."
        draft["boqGroups"] = [g for g in groups if g.get("items")]
        payload = {
            "boqGroups": draft["boqGroups"],
            "selectedVendors": draft.get("selectedVendors") or {},
            "substitutions": draft.get("substitutions") or [],
            "items": draft.get("items") or [],
        }
        result = await client.put("/api/po/cart", payload)
        if not result.get("ok"):
            return f"Remove failed: {result.get('error')}"
        return json.dumps({"status": "success", "message": "Item removed"})

    return [get_cart, add_to_cart, update_cart, remove_from_cart]
