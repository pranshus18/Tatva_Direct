from enum import Enum
from typing import Any, Callable, Awaitable, Optional

from agent.intents import CONFIRM_PATTERNS, REJECT_PATTERNS, Intent, classify_intent


class PendingActionType(str, Enum):
    PLACE_ORDER = "place_order"
    PAYMENT = "payment"
    CANCEL_ORDER = "cancel_order"


async def handle_confirmation_gate(
    user_text: str,
    pending: Optional[dict],
    *,
    on_confirm: Callable[[dict], Awaitable[str]],
    on_reject: Callable[[], Awaitable[str]],
) -> tuple[bool, Optional[str]]:
    """
    If pending action exists, interpret yes/no.
    Returns (handled, response_text).
    """
    if not pending:
        return False, None

    intent = classify_intent(user_text)
    if intent == Intent.CONFIRM or CONFIRM_PATTERNS.search(user_text or ""):
        return True, await on_confirm(pending)
    if intent == Intent.REJECT or REJECT_PATTERNS.search(user_text or ""):
        return True, await on_reject()
    return False, (
        f"I'm waiting for your confirmation to {pending.get('summary', 'complete this action')}. "
        "Please say yes to confirm or no to cancel."
    )


def build_pending(action_type: PendingActionType, summary: str, payload: dict[str, Any]) -> dict:
    return {
        "type": action_type.value,
        "summary": summary,
        "payload": payload,
    }
