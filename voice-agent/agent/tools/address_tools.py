import json

from langchain_core.tools import tool

from integrations.tatva_api_client import TatvaApiClient


def build_address_tools(client: TatvaApiClient):
    @tool
    async def get_profile_addresses() -> str:
        """Get current shipping and billing addresses on profile."""
        result = await client.get("/api/profile")
        if not result.get("ok"):
            return f"Could not load profile: {result.get('error')}"
        user = result["data"].get("user") or result["data"]
        return json.dumps(
            {
                "address": user.get("address"),
                "billingAddresses": (user.get("profile") or {}).get("billingAddresses"),
            }
        )

    @tool
    async def update_shipping_address(
        line1: str,
        city: str,
        state: str,
        pincode: str,
        country: str = "India",
    ) -> str:
        """Update service provider shipping address."""
        result = await client.put(
            "/api/profile",
            {
                "address": {
                    "line1": line1,
                    "city": city,
                    "state": state,
                    "pincode": pincode,
                    "country": country,
                }
            },
        )
        if not result.get("ok"):
            return f"Address update failed: {result.get('error')}"
        return json.dumps({"status": "success", "message": "Shipping address updated"})

    return [get_profile_addresses, update_shipping_address]
