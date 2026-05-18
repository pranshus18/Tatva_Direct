/**
 * Spoken prompts for the one-call voice shopping + checkout flow.
 * Keep replies short for TTS; each prompt ends with what to say next.
 */

export const FLOW_STEPS = {
  search: { n: 1, label: 'Product search' },
  quantity: { n: 2, label: 'Quantity' },
  suppliers: { n: 3, label: 'Supplier selection' },
  substitution: { n: 4, label: 'Substitution' },
  po_details: { n: 5, label: 'Purchase order details' },
  transport: { n: 6, label: 'Transport selection' },
  confirm_order: { n: 7, label: 'Order confirmation' },
  done: { n: 8, label: 'Complete' }
};

function stepPrefix(stepKey) {
  const s = FLOW_STEPS[stepKey];
  return s ? `Step ${s.n}, ${s.label}. ` : '';
}

export function isHelpPhrase(text) {
  return /\b(what('?s)? next|what do i say|help|where am i|which step|repeat)\b/i.test(
    String(text || '')
  );
}

export function helpForPending(pendingType, checkout = {}) {
  const map = {
    await_add_quantity: `${stepPrefix('quantity')}Say how many you want — for example 2, two, or two nos.`,
    await_pick_product: `${stepPrefix('quantity')}Say the product number from the list, then say how many.`,
    await_select_supplier: `${stepPrefix('suppliers')}Say supplier number 1, or say the supplier name.`,
    await_substitution: `${stepPrefix('substitution')}Say no substitution to skip, or yes to accept suggestions.`,
    await_po_details: poHelp(checkout),
    await_place_confirm: `${stepPrefix('confirm_order')}Say place the order to buy, or say no to cancel.`,
    await_transport: `${stepPrefix('transport')}Say transport number 1, or say the courier name. If quotes failed, say retry.`
  };
  return map[pendingType] || 'Say a product name to search, or continue with your last question.';
}

function poHelp(checkout) {
  const field = checkout.pendingPoField;
  if (field === 'requiredDate') {
    return `${stepPrefix('po_details')}Say a delivery date like 20 May 2026, or say default.`;
  }
  if (field === 'paymentMethod') {
    return `${stepPrefix('po_details')}Say cash on delivery, online, or bank transfer.`;
  }
  if (field === 'confirmAddresses') {
    return `${stepPrefix('po_details')}Say yes to confirm your shipping address.`;
  }
  return `${stepPrefix('po_details')}Answer the question I just asked about your order.`;
}

// —— Search ——

export function promptSearchSingle(productName) {
  return `${stepPrefix('search')}I found ${productName}. ${stepPrefix('quantity')}How many do you want in your cart? Say a number, for example 2.`;
}

export function promptSearchMultiple(lines, total) {
  return `${stepPrefix('search')}I found ${total} products. ${lines}. ${stepPrefix('quantity')}Say the product number, then how many you need. Or say add to cart.`;
}

export function promptSearchNotFound(query) {
  return query
    ? `I could not find a close match for "${query}". Try saying the product name again, or a shorter name like cement, steel rod, or Mac Air.`
    : 'I could not find that product. Say the product name you need, for example cement or Mac Air M2.';
}

export function promptSearchFuzzy(query, lines, total) {
  return `${stepPrefix('search')}I heard "${query}". Here are the closest matches I found: ${lines}. ${stepPrefix('quantity')}Say the product number, or say the name again more clearly.`;
}

// —— Cart / quantity ——

export function promptAskQuantity(productName) {
  return `${stepPrefix('quantity')}How many ${productName} should I add to your cart? Say a number.`;
}

export function promptPickProduct(choices) {
  return `${stepPrefix('quantity')}Which product? ${choices}. Say the number first, then how many.`;
}

export function promptAddedToCart(productName) {
  return `Added ${productName} to your cart.`;
}

// —— Suppliers ——

export function formatVendorDetail(v, i) {
  const name = v.name || v.supplierName || v.company || 'Supplier';
  const price = v.price != null ? `price ${v.price} rupees` : '';
  const stock = v.stock != null ? `${v.stock} in stock` : '';
  const dist = v.distanceKm != null ? `${Math.round(v.distanceKm)} kilometres away` : '';
  const rating = v.rating != null ? `rating ${v.rating} out of 5` : '';
  const lead = v.leadTime != null ? `delivery about ${v.leadTime} days` : '';
  const parts = [price, stock, dist, rating, lead].filter(Boolean);
  return `Supplier ${i + 1}, ${name}. ${parts.join('. ')}.`;
}

export function promptSuppliers(count, vendorLines) {
  return truncate(
    `${stepPrefix('suppliers')}There ${count === 1 ? 'is' : 'are'} ${count} supplier${count === 1 ? '' : 's'} for this product. ${vendorLines.join(' ')} ${stepPrefix('suppliers')}Say supplier number 1, or say the supplier name you want.`
  );
}

export function promptSupplierRetry(max) {
  return `I did not catch that. Say supplier number 1 to ${max}, or say the supplier name.`;
}

export function promptSupplierChosen(name) {
  return `You chose ${name}.`;
}

// —— Substitution ——

export function promptNoSubstitutions(supplierName) {
  return `${promptSupplierChosen(supplierName)} No substitution suggestions. Moving to order details.`;
}

export function promptSubstitutions(supplierName, count, subLines) {
  return truncate(
    `${promptSupplierChosen(supplierName)} ${stepPrefix('substitution')}I have ${count} substitution suggestion${count === 1 ? '' : 's'}: ${subLines.join('. ')}. Say no substitution to skip, or yes to accept all.`
  );
}

export function promptSubstitutionRetry() {
  return `${stepPrefix('substitution')}Say no substitution to skip this step, or yes to accept the suggestions.`;
}

// —— PO details ——

export function promptPoRequiredDate() {
  return `${stepPrefix('po_details')}What is the required delivery date? Say a date like 20 May 2026, or say default for one week from today.`;
}

export function promptPoPayment() {
  return `${stepPrefix('po_details')}How will you pay? Say cash on delivery, online payment, or bank transfer.`;
}

export function promptPoAddress(shipLine) {
  return `${stepPrefix('po_details')}Your shipping address is ${shipLine || 'on your profile'}. Say yes to confirm, or update your profile on the website first.`;
}

export function promptPoDateRetry() {
  return 'Say a date like 2026-05-20, or say default.';
}

export function promptPoPaymentRetry() {
  return 'Say cash on delivery, online, or bank transfer.';
}

export function promptPoAddressRetry() {
  return 'Say yes to confirm the address.';
}

export function formatPaymentLabel(method) {
  const m = String(method || '').toLowerCase();
  if (m === 'cod') return 'cash on delivery';
  if (m === 'online') return 'online payment';
  if (m === 'bank_transfer') return 'bank transfer';
  return method || 'not set';
}

export function promptOrderSummary(groups, grandTotal, requiredDate, paymentMethod, transportSummary) {
  const pay = formatPaymentLabel(paymentMethod);
  const transportPart = transportSummary ? ` Transport: ${transportSummary}.` : '';
  return truncate(
    `${stepPrefix('confirm_order')}Here is your order summary. ${groups}. Grand total about ${grandTotal} rupees. Delivery by ${requiredDate}. Payment: ${pay}.${transportPart} ${stepPrefix('confirm_order')}Say place the order to confirm, or say no to cancel.`
  );
}

export function promptPlaceOrderRetry() {
  return `${stepPrefix('confirm_order')}Say place the order to confirm, or say no to cancel.`;
}

export function promptPlacingOrder() {
  return 'Placing your order now. Please wait.';
}

export function promptLoadingTransport() {
  return `${stepPrefix('transport')}Loading transport quotes. This may take up to a minute. Please wait.`;
}

// —— Transport ——

export function promptTransportOptions(vendorLines) {
  return truncate(
    `${stepPrefix('transport')}Choose transport before we place the order. ${vendorLines.join(' ')} Say transport number 1, or say the courier name.`
  );
}

export function promptTransportRetry() {
  return `${stepPrefix('transport')}Transport is required before placing the order. Say transport number 1, or say the courier name.`;
}

export function promptTransportQuotesFailed(error) {
  const detail = error ? ` ${error}.` : '';
  return truncate(
    `${stepPrefix('transport')}I could not load courier quotes.${detail} Say retry to load quotes again, or update your shipping pincode on the website. You cannot place the order without transport.`
  );
}

export function promptTransportNoQuotes(message) {
  const detail = message ? ` ${message}.` : '';
  return truncate(
    `${stepPrefix('transport')}No courier quotes are available for your address.${detail} Say retry, or update your profile address and pincode on the website. Transport is required before checkout.`
  );
}

export function promptTransportPickRemaining(count) {
  const extra =
    count > 1
      ? ` ${count} suppliers still need a courier.`
      : ' One more supplier needs a courier.';
  return `${stepPrefix('transport')}Pick transport for each supplier.${extra} Say transport number 1, or say the courier name.`;
}

export function promptTransportRequiredBeforeOrder() {
  return `${stepPrefix('transport')}You must choose transport before placing the order. Say retry to load couriers, or say transport number 1.`;
}

export function promptOrderComplete(orderNumbers) {
  return `${stepPrefix('done')}Your order is placed${orderNumbers ? `, order number ${orderNumbers}` : ''}. Transport is booked. You can search for another product or say end the call.`;
}

export function promptCheckoutCancelled() {
  return 'Checkout cancelled. You can search for another product.';
}

function truncate(text, max = 480) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
