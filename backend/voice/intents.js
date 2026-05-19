const CONFIRM =
  /\b(yes|yeah|yep|confirm|confirmed|go ahead|proceed|ok|okay|do it|place it|place order|place the order)\b/i;
const REJECT = /\b(no|nope|cancel that|don't|do not|stop|never mind|nevermind)\b/i;

export function classifyIntent(text) {
  const t = String(text || '').trim();
  if (!t) return 'unknown';
  if (CONFIRM.test(t)) return 'confirm';
  if (REJECT.test(t)) return 'reject';
  if (/\b(refund|return|policy|policies|support|help|faq|warranty|shipping|delivery time|payment method|how do i)\b/i.test(t)) return 'support';
  if (/\b(track|order status|cancel order|reorder|my orders?)\b/i.test(t)) return 'order_mgmt';
  if (/\b(checkout|place order|buy|payment|pay)\b/i.test(t)) return 'checkout';
  if (/\b(address|shipping|delivery address|billing)\b/i.test(t)) return 'address';
  if (/\b(cart|add|remove|update quantity|basket)\b/i.test(t)) return 'cart';
  if (/\b(search|find|look for|show me|products?|stock|inventory)\b/i.test(t)) return 'search';
  return 'unknown';
}

export function isConfirm(text) {
  return CONFIRM.test(String(text || ''));
}

export function isReject(text) {
  return REJECT.test(String(text || ''));
}
