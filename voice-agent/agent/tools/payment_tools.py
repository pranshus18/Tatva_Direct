import json

from langchain_core.tools import tool

from integrations.tatva_api_client import TatvaApiClient


def build_payment_tools(client: TatvaApiClient, memory):
    @tool
    async def select_payment_method(order_id: str, method: str = "online") -> str:
        """
        Choose payment method for an order: online (Razorpay), cod, bank_transfer, or credit.
        Online payment requires confirmation.
        """
        method = (method or "online").lower().strip()
        if method == "online":
            memory.set_pending_action(
                {
                    "type": "payment",
                    "summary": f"start online payment for order {order_id}",
                    "payload": {"order_id": order_id, "method": "online"},
                }
            )
            return (
                f"I can start online payment for order {order_id}. "
                "Say yes to confirm, or no to cancel."
            )
        if method == "bank_transfer":
            res = await client.post(
                f"/api/payments/orders/{order_id}/bank-transfer/request",
                {},
            )
            if not res.get("ok"):
                return f"Bank transfer request failed: {res.get('error')}"
            return json.dumps(res["data"])
        return json.dumps({"status": "success", "message": f"Payment method noted: {method}"})

    async def execute_online_payment(order_id: str) -> str:
        res = await client.post(f"/api/payments/orders/{order_id}/razorpay/create", {})
        if not res.get("ok"):
            return f"Payment setup failed: {res.get('error')}"
        data = res["data"]
        return (
            "Online payment intent created. "
            f"Complete payment in the app if prompted. Details: {json.dumps(data)[:400]}"
        )

    return {"tools": [select_payment_method], "execute_online_payment": execute_online_payment}
