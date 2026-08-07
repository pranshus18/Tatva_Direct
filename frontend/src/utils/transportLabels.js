/** Display name persisted as shippingProvider for supplier-managed delivery. */
export const SELF_SHIP_PROVIDER_NAME = 'Shipment by supplier';

const SELF_SHIP_PROVIDER_NAME_VARIANTS = new Set([
  'self ship',
  'self-ship',
  'shipment by supplier'
]);

export function normalizeTransportProviderName(name) {
  return String(name || '').trim().toLowerCase();
}

export function isSelfShipProviderName(name) {
  return SELF_SHIP_PROVIDER_NAME_VARIANTS.has(normalizeTransportProviderName(name));
}

export function isSelfShipTransport(detail, shippingProvider = '') {
  const mode = String(detail?.transportMode || detail?.transport_mode || '').toLowerCase();
  if (mode === 'self_ship') return true;
  const providerName = shippingProvider || detail?.name || '';
  return isSelfShipProviderName(providerName);
}
