import json
import logging
from typing import Any, Optional
from urllib.parse import urlencode

import httpx

from config import get_settings

logger = logging.getLogger(__name__)

ALLOWED_PREFIXES = (
    "/api/supplier/products/search",
    "/api/supplier/products/lookup",
    "/api/po/cart",
    "/api/po/group",
    "/api/po/create",
    "/api/po/",
    "/api/dashboard/service-provider",
    "/api/profile",
    "/api/payments/",
    "/api/vendors/rank",
    "/api/voice/",
)


class TatvaApiClient:
    def __init__(self, token: str):
        self.token = token
        self.base = get_settings().tatva_api_base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _validate_path(self, path: str) -> None:
        if not path.startswith("/api/"):
            raise ValueError("Path must start with /api/")
        if not any(path.startswith(p) for p in ALLOWED_PREFIXES):
            raise ValueError(f"Path not allowed for voice agent: {path}")

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[dict] = None,
        json_body: Optional[dict] = None,
        timeout: float = 60.0,
    ) -> dict[str, Any]:
        self._validate_path(path)
        url = f"{self.base}{path}"
        if params:
            qs = urlencode({k: v for k, v in params.items() if v is not None})
            url = f"{url}?{qs}" if qs else url

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method.upper(),
                url,
                headers=self._headers,
                json=json_body,
            )

        try:
            data = response.json()
        except Exception:
            data = {"status": "error", "message": response.text[:500]}

        if response.status_code >= 400:
            msg = data.get("message") if isinstance(data, dict) else str(data)
            return {
                "ok": False,
                "status_code": response.status_code,
                "error": msg or f"HTTP {response.status_code}",
                "data": data,
            }
        return {"ok": True, "status_code": response.status_code, "data": data}

    async def get(self, path: str, params: Optional[dict] = None) -> dict[str, Any]:
        return await self.request("GET", path, params=params)

    async def post(self, path: str, body: Optional[dict] = None) -> dict[str, Any]:
        return await self.request("POST", path, json_body=body or {})

    async def put(self, path: str, body: Optional[dict] = None) -> dict[str, Any]:
        return await self.request("PUT", path, json_body=body or {})

    async def patch(self, path: str, body: Optional[dict] = None) -> dict[str, Any]:
        return await self.request("PATCH", path, json_body=body or {})

    async def delete(self, path: str) -> dict[str, Any]:
        return await self.request("DELETE", path)

    def summarize(self, result: dict[str, Any], max_len: int = 1200) -> str:
        payload = result.get("data") if result.get("ok") else result
        text = json.dumps(payload, default=str)
        if len(text) > max_len:
            return text[: max_len - 3] + "..."
        return text
