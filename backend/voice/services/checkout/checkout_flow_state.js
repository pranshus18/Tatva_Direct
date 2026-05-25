/** Shared checkout session state and small parsers. */

import { parsePaymentMethodPhrase } from '../../lib/voiceIntentPhrases.js';
import { syncVoiceUiScreenForPending } from '../../lib/voice_ui_screens.js';

export const CHECKOUT_TYPES = new Set([
  'await_discovery_cart_handoff',
  'await_cart_continue',
  'await_select_supplier',
  'await_substitution',
  'await_po_details',
  'await_transport',
  'await_place_confirm'
]);

export function flattenCartItems(draft) {
  const items = [];
  for (const g of draft?.boqGroups || []) {
    for (const it of g.items || []) items.push(it);
  }
  return items;
}

export function getCheckout(memory) {
  return memory.getContext('checkout', {});
}

export function setCheckout(memory, patch) {
  memory.setContext('checkout', { ...getCheckout(memory), ...patch });
}

export function formatAddress(addr) {
  if (!addr) return '';
  return [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
}

export function setAwaitTransport(memory, payload = {}) {
  memory.setPendingAction({
    type: 'await_transport',
    summary: 'select transport',
    payload
  });
  syncVoiceUiScreenForPending(memory, 'await_transport');
}

export function parsePaymentMethod(text) {
  return parsePaymentMethodPhrase(text);
}

const TOMORROW_PATTERNS = [
  /\btomorrow\b/i,
  /\b(kal|aaj\s+ke\s+baad)\b/i,
  /\b(naale|naalege)\b/i,
  /\b(repu|repuki)\b/i,
  /कल/,
  /ನಾಳೆ/,
  /రేపు/
];

export function parseRequiredDate(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (TOMORROW_PATTERNS.some((re) => re.test(t))) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

export function defaultRequiredDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}
