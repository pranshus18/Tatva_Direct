import { truncateForSpeech } from '../../summarizeForVoice.js';
import { isReject, isConfirm } from '../../intents.js';
import {
  promptPlaceOrderRetry,
  promptPlacingOrder,
  promptOrderComplete,
  promptLoadingTransport,
  promptTransportRequiredBeforeOrder
} from '../../lib/voice_prompts.js';
import { hasMandatoryTransportSelected } from '../../lib/transportGate.js';
import { getCheckout, setCheckout, setAwaitTransport } from './checkout_flow_state.js';
import { loadTransportQuotes } from './checkout_flow_transport.js';

export async function placeOrderAndConfirmTransport(toolCtx, memory) {
  const { client } = toolCtx;
  const checkout = getCheckout(memory);

  if (!hasMandatoryTransportSelected(checkout)) {
    setAwaitTransport(memory, {
      optionsByVendor: checkout.optionsByVendor,
      quotesLoaded: Boolean(checkout.optionsByVendor)
    });
    return truncateForSpeech(promptTransportRequiredBeforeOrder());
  }

  const createRes = await client.post('/api/po/create', {
    poGroups: checkout.poGroups,
    requiredDate: checkout.requiredDate,
    paymentMethod: checkout.paymentMethod,
    deliveryDestination: checkout.gstin ? checkout.deliveryDestination || 'shipping' : 'shipping',
    shippingAddress: checkout.shippingAddress,
    billingAddress: checkout.billingAddress || checkout.shippingAddress,
    gstin: checkout.gstin || null
  });
  if (!createRes.ok) {
    return `Order creation failed: ${createRes.error}`;
  }

  const orders = createRes.data?.orders || [];
  if (!orders.length) {
    return 'Orders were not created. Please finish on the website.';
  }

  const byVendorId = checkout.transportByVendor || {};
  const transportDetailByVendor = checkout.transportDetailByVendor || {};

  if (Object.keys(byVendorId).length > 0) {
    const orderIds = orders.map((o) => o.id).filter(Boolean);
    const perOrderTransport = orders.map((o) => {
      const sid = String(o.supplierId || '');
      const det = transportDetailByVendor[sid];
      const row = {
        orderId: o.id,
        shippingProvider: byVendorId[sid] || '',
        trackingNumber: null,
        trackingUrl: null,
        transportNotes: 'Voice checkout'
      };
      if (det?.courier_company_id) row.courierCompanyId = Number(det.courier_company_id);
      if (det?.vehicle_type_id) row.vehicleTypeId = Number(det.vehicle_type_id);
      if (det?.rate != null) {
        row.quotedTransportAmount = Number(String(det.rate).replace(/,/g, '')) || null;
      }
      return row;
    });

    const confirmRes = await client.post('/api/po/transport/confirm', {
      orderIds,
      perOrderTransport
    });
    if (!confirmRes.ok) {
      const nums = orders.map((o) => o.order_number || o.id).join(', ');
      return `Order created${nums ? ` (${nums})` : ''}, but transport booking failed: ${confirmRes.error}. Finish transport on the website.`;
    }
  }

  memory.setPendingAction(null);
  const nums = orders.map((o) => o.order_number || o.id).join(', ');
  return truncateForSpeech(promptOrderComplete(nums));
}

export async function handlePlaceConfirm(toolCtx, memory, utterance) {
  if (isReject(utterance)) {
    memory.setPendingAction(null);
    return 'Order not placed. Say a product name to start again.';
  }
  if (!isConfirm(utterance) && !/\b(place (the )?order|confirm order|submit)\b/i.test(utterance)) {
    return promptPlaceOrderRetry();
  }

  const checkout = getCheckout(memory);
  if (!hasMandatoryTransportSelected(checkout)) {
    const loading = checkout.poGroups?.length ? promptLoadingTransport() : '';
    if (!checkout.optionsByVendor || !Object.keys(checkout.optionsByVendor).length) {
      const step = await loadTransportQuotes(toolCtx, memory);
      return truncateForSpeech(`${loading} ${step}`.trim());
    }
    setAwaitTransport(memory, {
      optionsByVendor: checkout.optionsByVendor,
      quotesLoaded: true
    });
    return truncateForSpeech(promptTransportRequiredBeforeOrder());
  }

  memory.setPendingAction(null);
  const placing = promptPlacingOrder();
  const result = await placeOrderAndConfirmTransport(toolCtx, memory);
  return `${placing} ${result}`;
}
