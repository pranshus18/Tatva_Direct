import re
from enum import Enum


class Intent(str, Enum):
    SEARCH = "search"
    CART = "cart"
    CHECKOUT = "checkout"
    ORDER_MGMT = "order_mgmt"
    ADDRESS = "address"
    SUPPORT = "support"
    CONFIRM = "confirm"
    REJECT = "reject"
    UNKNOWN = "unknown"


CONFIRM_PATTERNS = re.compile(
    r"\b(yes|yeah|yep|confirm|confirmed|go ahead|proceed|ok|okay|do it|place it|place order)\b",
    re.I,
)
REJECT_PATTERNS = re.compile(
    r"\b(no|nope|cancel that|don't|do not|stop|never mind|nevermind)\b",
    re.I,
)

SEARCH_PATTERNS = re.compile(r"\b(search|find|look for|show me|products?)\b", re.I)
CART_PATTERNS = re.compile(r"\b(cart|add|remove|update quantity|basket)\b", re.I)
CHECKOUT_PATTERNS = re.compile(r"\b(checkout|place order|buy|payment|pay)\b", re.I)
ORDER_PATTERNS = re.compile(r"\b(track|order status|cancel order|reorder|my orders?)\b", re.I)
ADDRESS_PATTERNS = re.compile(r"\b(address|shipping|delivery address|billing)\b", re.I)
SUPPORT_PATTERNS = re.compile(r"\b(refund|return policy|support|help|faq|warranty|shipping policy)\b", re.I)
INVENTORY_PATTERNS = re.compile(r"\b(stock|inventory|available|in stock)\b", re.I)


def classify_intent(text: str) -> Intent:
    t = (text or "").strip()
    if not t:
        return Intent.UNKNOWN
    if CONFIRM_PATTERNS.search(t):
        return Intent.CONFIRM
    if REJECT_PATTERNS.search(t):
        return Intent.REJECT
    if SUPPORT_PATTERNS.search(t):
        return Intent.SUPPORT
    if INVENTORY_PATTERNS.search(t):
        return Intent.SEARCH
    if ORDER_PATTERNS.search(t):
        return Intent.ORDER_MGMT
    if CHECKOUT_PATTERNS.search(t):
        return Intent.CHECKOUT
    if ADDRESS_PATTERNS.search(t):
        return Intent.ADDRESS
    if CART_PATTERNS.search(t):
        return Intent.CART
    if SEARCH_PATTERNS.search(t):
        return Intent.SEARCH
    return Intent.UNKNOWN
