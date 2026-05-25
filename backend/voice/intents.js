import {
  isConfirmPhrase,
  isRejectPhrase,
  isSupportTopicPhrase,
  isOrderTrackPhrase,
  isOrderCancelPhrase,
  isOrderReorderPhrase,
  isCheckoutCommandPhrase,
  isAddressPhrase,
  isAddToCartIntent,
  isRemoveFromCartPhrase,
  isOpenCartPhrase,
  isClearCartPhrase,
  isSearchCommandPhrase,
  isInventoryPhrase,
  isProceduralStartPhrase
} from './lib/voiceIntentPhrases.js';

export function classifyIntent(text) {
  const t = String(text || '').trim();
  if (!t) return 'unknown';
  if (isConfirmPhrase(t)) return 'confirm';
  if (isRejectPhrase(t)) return 'reject';
  if (isSupportTopicPhrase(t) || isProceduralStartPhrase(t)) return 'support';
  if (isOrderTrackPhrase(t) || isOrderCancelPhrase(t) || isOrderReorderPhrase(t)) return 'order_mgmt';
  if (isCheckoutCommandPhrase(t) || /\b(payment|pay)\b/i.test(t)) return 'checkout';
  if (isAddressPhrase(t)) return 'address';
  if (isAddToCartIntent(t) || isRemoveFromCartPhrase(t) || isOpenCartPhrase(t) || isClearCartPhrase(t)) {
    return 'cart';
  }
  if (isSearchCommandPhrase(t) || isInventoryPhrase(t)) return 'search';
  return 'unknown';
}

export function isConfirm(text) {
  return isConfirmPhrase(text);
}

export function isReject(text) {
  return isRejectPhrase(text);
}
