import json
import logging
import time
import uuid
from typing import Any, Optional

from config import get_settings

logger = logging.getLogger(__name__)

_memory_store: dict[str, dict[str, Any]] = {}
_redis = None


def _redis_client():
    global _redis
    if _redis is not None:
        return _redis
    settings = get_settings()
    try:
        import redis

        _redis = redis.from_url(settings.redis_url, decode_responses=True)
        _redis.ping()
        logger.info("Redis session store connected")
    except Exception as exc:
        logger.warning("Redis unavailable, using in-memory sessions: %s", exc)
        _redis = False
    return _redis


def new_session_id() -> str:
    return str(uuid.uuid4())


class SessionMemory:
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.ttl = get_settings().voice_session_ttl_sec
        self.prefix = f"voice:{session_id}"

    def _key(self, suffix: str) -> str:
        return f"{self.prefix}:{suffix}"

    def _get_raw(self, suffix: str) -> Optional[str]:
        key = self._key(suffix)
        r = _redis_client()
        if r and r is not False:
            return r.get(key)
        bucket = _memory_store.get(self.session_id, {})
        entry = bucket.get(suffix)
        if not entry:
            return None
        if entry["expires_at"] < time.time():
            return None
        return entry["value"]

    def _set_raw(self, suffix: str, value: str) -> None:
        key = self._key(suffix)
        r = _redis_client()
        if r and r is not False:
            r.setex(key, self.ttl, value)
            return
        bucket = _memory_store.setdefault(self.session_id, {})
        bucket[suffix] = {"value": value, "expires_at": time.time() + self.ttl}

    def get_json(self, suffix: str, default: Any = None) -> Any:
        raw = self._get_raw(suffix)
        if raw is None:
            return default
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return default

    def set_json(self, suffix: str, value: Any) -> None:
        self._set_raw(suffix, json.dumps(value))

    def append_message(self, role: str, content: str, limit: int = 20) -> None:
        messages = self.get_json("messages", [])
        messages.append({"role": role, "content": content})
        self.set_json("messages", messages[-limit:])

    def get_messages(self) -> list[dict]:
        return self.get_json("messages", [])

    def set_pending_action(self, action: Optional[dict]) -> None:
        if action is None:
            self._set_raw("pending_action", "")
        else:
            self.set_json("pending_action", action)

    def get_pending_action(self) -> Optional[dict]:
        val = self.get_json("pending_action")
        return val if val else None

    def set_context(self, key: str, value: Any) -> None:
        ctx = self.get_json("context", {})
        ctx[key] = value
        self.set_json("context", ctx)

    def get_context(self, key: str, default: Any = None) -> Any:
        return self.get_json("context", {}).get(key, default)
