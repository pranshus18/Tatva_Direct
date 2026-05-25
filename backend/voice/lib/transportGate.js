/** Pure transport-selection rules for voice checkout (testable, no I/O). */

export function listTransportVendorEntriesFromCheckout(checkout = {}) {
  const optionsByVendor = checkout.optionsByVendor || {};
  const fromOptions = Object.entries(optionsByVendor)
    .filter(([id]) => id)
    .map(([vendorId, entry]) => ({
      vendorId,
      providers: Array.isArray(entry?.providers) ? entry.providers : []
    }));
  if (fromOptions.length) return fromOptions;

  const providersFromShipment = (sh) => {
    if (Array.isArray(sh?.providers) && sh.providers.length) return sh.providers;
    if (Array.isArray(sh?.logistics?.providers) && sh.logistics.providers.length) {
      return sh.logistics.providers;
    }
    return [];
  };

  return (checkout.shipments || [])
    .map((sh) => ({
      vendorId: String(sh.vendorId || sh.supplierId || sh.vendor_id || ''),
      providers: providersFromShipment(sh)
    }))
    .filter((e) => e.vendorId);
}

export function vendorsMissingTransport(checkout = {}) {
  const byVendor = checkout.transportByVendor || {};
  return listTransportVendorEntriesFromCheckout(checkout).filter(
    (e) =>
      e.providers.length > 0 &&
      (!byVendor[e.vendorId] || !String(byVendor[e.vendorId]).trim())
  );
}

export function hasMandatoryTransportSelected(checkout = {}) {
  const withQuotes = listTransportVendorEntriesFromCheckout(checkout).filter(
    (e) => e.providers.length > 0
  );
  if (!withQuotes.length) return false;
  return vendorsMissingTransport(checkout).length === 0;
}

export { isTransportRetryPhrase } from './voiceIntentPhrases.js';
