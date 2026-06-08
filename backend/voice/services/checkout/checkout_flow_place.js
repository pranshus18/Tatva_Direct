import { truncateForSpeech } from '../../summarizeForVoice.js';
import { isReject, isConfirm } from '../../intents.js';
import { isPlaceOrderPhrase } from '../../lib/voiceIntentPhrases.js';
import {
  promptPlaceOrderRetry,
  promptPlacingOrder,
  promptOrderComplete,
  promptTransportRequiredBeforeOrder
} from '../../lib/voice_prompts.js';
import { hasMandatoryTransportSelected } from '../../lib/transportGate.js';
import { getCheckout, setAwaitTransport } from './checkout_flow_state.js';
import { loadTransportQuotes } from './checkout_flow_transport.js';
import { getVoiceText } from '../../i18n/index.js';
import { resolveVoiceLanguage } from '../../lib/voiceLanguage.js';

export async function placeOrderAndConfirmTransport(toolCtx, memory) {
  const { client } = toolCtx;
  const checkout = getCheckout(memory);
  const lang = resolveVoiceLanguage(memory);

  if (!hasMandatoryTransportSelected(checkout)) {
    setAwaitTransport(memory, {
      optionsByVendor: checkout.optionsByVendor,
      quotesLoaded: Boolean(checkout.optionsByVendor)
    });
    return truncateForSpeech(promptTransportRequiredBeforeOrder(memory));
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
    return getVoiceText('checkout.orderCreationFailed', lang, { error: createRes.error }, '');
  }

  const orders = createRes.data?.orders || [];
  if (!orders.length) {
    return getVoiceText('checkout.ordersNotCreated', lang, {}, '');
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
      const transportMode = String(det?.transport_mode || det?.transportMode || '').toLowerCase();
      const isTrucking =
        transportMode === 'trucking' ||
        String(det?.source || '').toLowerCase() === 'borzo' ||
        (det?.vehicle_type_id != null && Number(det.vehicle_type_id) > 0);
      if (isTrucking) {
        row.transportMode = 'trucking';
        if (det?.vehicle_type_id) row.vehicleTypeId = Number(det.vehicle_type_id);
        if (det?.pickup_lat != null) row.pickupLat = Number(det.pickup_lat);
        if (det?.pickup_lng != null) row.pickupLng = Number(det.pickup_lng);
        if (det?.delivery_lat != null) row.deliveryLat = Number(det.delivery_lat);
        if (det?.delivery_lng != null) row.deliveryLng = Number(det.delivery_lng);
        if (det?.carrier) row.carrier = String(det.carrier);
        if (det?.weightKg != null) row.weightKg = Number(det.weightKg);
      } else {
        row.transportMode = 'courier';
        if (det?.courier_company_id) row.courierCompanyId = Number(det.courier_company_id);
      }
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
      const orderRef = nums ? ` (${nums})` : '';
      return getVoiceText(
        'checkout.orderCreatedTransportFailed',
        lang,
        { orderRef, error: confirmRes.error },
        ''
      );
    }
  }

  memory.setPendingAction(null);
  const nums = orders.map((o) => o.order_number || o.id).join(', ');
  return truncateForSpeech(promptOrderComplete(nums, memory));
}

export async function handlePlaceConfirm(toolCtx, memory, utterance) {
  const lang = resolveVoiceLanguage(memory);

  if (isReject(utterance)) {
    memory.setPendingAction(null);
    return getVoiceText('confirm.rejectStartAgain', lang, {}, '');
  }
  if (!isPlaceOrderPhrase(utterance)) {
    return promptPlaceOrderRetry(memory);
  }

  const checkout = getCheckout(memory);
  if (!hasMandatoryTransportSelected(checkout)) {
    if (!checkout.optionsByVendor || !Object.keys(checkout.optionsByVendor).length) {
      const step = await loadTransportQuotes(toolCtx, memory);
      return truncateForSpeech(step);
    }
    setAwaitTransport(memory, {
      optionsByVendor: checkout.optionsByVendor,
      quotesLoaded: true
    });
    return truncateForSpeech(promptTransportRequiredBeforeOrder(memory));
  }

  memory.setPendingAction(null);
  const placing = promptPlacingOrder(memory);
  const result = await placeOrderAndConfirmTransport(toolCtx, memory);
  return `${placing} ${result}`;
}
