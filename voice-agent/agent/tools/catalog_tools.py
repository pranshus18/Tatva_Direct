import json
from typing import Optional

from langchain_core.tools import tool

from integrations.tatva_api_client import TatvaApiClient


def build_catalog_tools(client: TatvaApiClient):
    @tool
    async def search_products(query: str = "", category: str = "", limit: int = 5) -> str:
        """Search the product catalog. Use for product search and recommendations."""
        params = {"limit": min(max(limit, 1), 20), "page": 1}
        if query.strip():
            params["q"] = query.strip()
        if category.strip():
            params["category"] = category.strip()
        result = await client.get("/api/supplier/products/search", params)
        if not result.get("ok"):
            return f"Search failed: {result.get('error')}"
        data = result["data"]
        items = data.get("suggestions") or []
        brief = [
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "category": p.get("category"),
                "brand": p.get("brand"),
            }
            for p in items[:limit]
        ]
        return json.dumps(
            {
                "total": data.get("total"),
                "recommendationMode": data.get("recommendationMode"),
                "products": brief,
            }
        )

    @tool
    async def get_recommendations(limit: int = 5) -> str:
        """Get personalized product recommendations based on order history."""
        return await search_products(query="", category="", limit=limit)

    @tool
    async def check_inventory(product_id: str) -> str:
        """Check stock availability for a product by UUID."""
        result = await client.get(f"/api/voice/products/{product_id}/availability")
        if not result.get("ok"):
            return f"Inventory check failed: {result.get('error')}"
        return json.dumps(result["data"])

    return [search_products, get_recommendations, check_inventory]
