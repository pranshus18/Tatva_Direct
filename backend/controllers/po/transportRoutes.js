/** PO routes: transport */
import {
  bookCourierCheckout,
  bookTrucking,
  scheduleCourier,
  getContractErrorMessage,
  logger,
  parseWithSchema,
  poTransportConfirmSchema
} from './poImports.js';
import {
  buildCourierLinesFromOrderItems,
  computeOrderWeightKgForCourier,
  isLogisticsDeliveryAddressComplete,
  orderDeliveryJsonToLogisticsAddress
} from '../../utils/logisticsTransportHelpers.js';
import {
  resolveBookingIntent,
  TRANSPORT_KIND
} from '../../utils/logisticsTransportIntent.js';
import { getSupplierPickupMeta } from '../../utils/pickupPincode.js';

export function registerPoTransportRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProviderOrSupplier,
    supabase
  } = ctx;

router.post('/transport/confirm', authenticateToken, isServiceProviderOrSupplier, async (req, res) => {
  try {
    const transportBookDebug =
      String(process.env.LOGISTICS_BOOK_DEBUG || '').toLowerCase() === 'true';
    const payload = parseWithSchema(poTransportConfirmSchema, req.body || {});
    const {
      orderIds,
      shippingProvider,
      trackingNumber = null,
      trackingUrl = null,
      transportNotes = null,
      perOrderTransport,
      quotedTransportAmount: rootQuotedTransportAmount,
      courierCompanyId: rootCourierCompanyId = null,
      vehicleTypeId: rootVehicleTypeId = null,
      pickupLat: rootPickupLat = null,
      pickupLng: rootPickupLng = null,
      deliveryLat: rootDeliveryLat = null,
      deliveryLng: rootDeliveryLng = null,
      carrier: rootCarrier = null,
      matter: rootMatter = null
    } = payload;

    const transportByOrderId = new Map(
      (Array.isArray(perOrderTransport) ? perOrderTransport : []).map((r) => [r.orderId, r])
    );
    const hasPerOrderRows = transportByOrderId.size > 0;

    const parseQuotedInr = (raw) => {
      if (raw === null || raw === undefined || raw === '') return null;
      const n = Number(String(raw).replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) return null;
      return Math.round(n * 100) / 100;
    };

    const { data: buyerRow, error: buyerErr } = await supabase
      .from('users')
      .select('id, name, company, email, phone')
      .eq('id', req.userId)
      .maybeSingle();
    if (buyerErr) throw buyerErr;
    const sessionBuyer = {
      user_id: buyerRow?.id || req.userId,
      name: String(buyerRow?.name || '').trim(),
      company: String(buyerRow?.company || '').trim(),
      email: String(buyerRow?.email || '').trim(),
      phone: String(buyerRow?.phone || '').trim()
    };

    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select(
        `
        id,
        order_number,
        status_history,
        delivery_address,
        total_amount,
        supplier_id,
        service_provider_id,
        expected_delivery_date,
        payment_status,
        tracking_number,
        tracking_url,
        shipping_provider,
        order_items (
          id,
          product_id,
          quantity,
          unit_price,
          total_price,
          specifications,
          product:products ( name )
        )
      `
      )
      .in('id', orderIds)
      .eq('service_provider_id', req.userId);
    if (ordersError) throw ordersError;

    const foundIds = new Set((orders || []).map((row) => row.id));
    const missingIds = orderIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Some orders were not found for this service provider',
        missingOrderIds: missingIds
      });
    }

    const supplierIds = [...new Set((orders || []).map((row) => row.supplier_id).filter(Boolean))];
    const pickupPincodeBySupplierId = {};
    if (supplierIds.length > 0) {
      const { data: supplierRows } = await supabase
        .from('users')
        .select('id, address, profile')
        .in('id', supplierIds)
        .eq('user_type', 'supplier');
      for (const row of supplierRows || []) {
        pickupPincodeBySupplierId[row.id] = getSupplierPickupMeta(row).pincode || '';
      }
    }

    const rowContexts = [];
    for (const row of orders || []) {
      const pick = transportByOrderId.get(row.id);
      const sp = pick?.shippingProvider || shippingProvider;
      // Never accept / reveal carrier tracking until vault debit has succeeded.
      const orderPaid = String(row.payment_status || '').toLowerCase() === 'paid';
      const alreadyBooked = Boolean(String(row.tracking_number || '').trim());
      let tn = null;
      let tu = null;
      if (orderPaid) {
        tn = String(row.tracking_number || pick?.trackingNumber || trackingNumber || '').trim() || null;
        tu = String(row.tracking_url || pick?.trackingUrl || trackingUrl || '').trim() || null;
      }
      const tnotes = pick?.transportNotes ?? transportNotes;
      const allowLogisticsBook = orderPaid && !alreadyBooked;
      if (!sp || !String(sp).trim()) {
        return res.status(400).json({
          status: 'error',
          message: `Missing shipping provider for order ${row.id}`
        });
      }

      const fromRow = hasPerOrderRows ? parseQuotedInr(pick?.quotedTransportAmount) : null;
      const fromRoot =
        !hasPerOrderRows && orderIds.length === 1 && row.id === orderIds[0]
          ? parseQuotedInr(rootQuotedTransportAmount)
          : null;
      const transportAmt = fromRow ?? fromRoot ?? null;

      const prevAddr =
        row.delivery_address && typeof row.delivery_address === 'object' ? { ...row.delivery_address } : {};
      const existingBill =
        prevAddr.transportBill && typeof prevAddr.transportBill === 'object' ? prevAddr.transportBill : null;
      const existingTransport = Math.round((Number(existingBill?.amount || 0) || 0) * 100) / 100;
      const currentTotal = Math.round((parseFloat(row.total_amount || 0) || 0) * 100) / 100;
      const productsInclGstFromSummary = Math.round(
        (Number(prevAddr?.gstSummary?.totalAmount || 0) || 0) * 100
      ) / 100;
      const productsOnly =
        productsInclGstFromSummary > 0
          ? productsInclGstFromSummary
          : Math.max(0, Math.round((currentTotal - existingTransport) * 100) / 100);

      const isSingleRoot =
        !hasPerOrderRows && orderIds.length === 1 && row.id === orderIds[0];

      const courierCompanyId =
        pick?.courierCompanyId ?? (isSingleRoot ? rootCourierCompanyId : null);

      const vehicleTypeId =
        pick?.vehicleTypeId ?? (isSingleRoot ? rootVehicleTypeId : null);
      const transportMode = String(
        pick?.transportMode ?? (isSingleRoot ? payload.transportMode : null) ?? ''
      )
        .trim()
        .toLowerCase();
      const transportSource = String(pick?.source ?? (isSingleRoot ? payload.source : null) ?? '')
        .trim()
        .toLowerCase();
      const truckingWeightKg =
        pick?.weightKg ?? (isSingleRoot ? payload.weightKg : null) ?? null;
      const pickupLat = pick?.pickupLat ?? (isSingleRoot ? rootPickupLat : null);
      const pickupLng = pick?.pickupLng ?? (isSingleRoot ? rootPickupLng : null);
      const deliveryLat = pick?.deliveryLat ?? (isSingleRoot ? rootDeliveryLat : null);
      const deliveryLng = pick?.deliveryLng ?? (isSingleRoot ? rootDeliveryLng : null);
      const truckingCarrier = pick?.carrier ?? (isSingleRoot ? rootCarrier : null);
      const truckingMatter = pick?.matter ?? (isSingleRoot ? rootMatter : null);
      const transitDaysRaw = pick?.transitDays ?? (isSingleRoot ? payload.transitDays : null);
      const transitDays =
        transitDaysRaw === null || transitDaysRaw === undefined || transitDaysRaw === ''
          ? null
          : Number(transitDaysRaw);
      const transportGroupId = String(
        pick?.transportGroupId ?? (isSingleRoot ? payload.transportGroupId : null) ?? ''
      ).trim() || null;
      const pickupPincodeFromPick = String(
        pick?.pickupPincode ?? (isSingleRoot ? payload.pickupPincode : null) ?? ''
      ).replace(/\D/g, '').slice(0, 6);
      const pickupPincode =
        pickupPincodeFromPick.length === 6
          ? pickupPincodeFromPick
          : String(pickupPincodeBySupplierId[row.supplier_id] || '').replace(/\D/g, '').slice(0, 6);
      const etdRaw = pick?.etd ?? (isSingleRoot ? payload.etd : null);

      const logisticsDelivery = orderDeliveryJsonToLogisticsAddress(prevAddr);
      const bookingIntent = resolveBookingIntent({
        transportMode: transportMode || null,
        courierCompanyId,
        vehicleTypeId,
        source: transportSource,
        carrier: truckingCarrier,
        pickupLat,
        pickupLng,
        deliveryLat,
        deliveryLng
      });

      if (bookingIntent.error) {
        return res.status(400).json({
          status: 'error',
          message: `Order ${row.id}: ${bookingIntent.error}`
        });
      }

      const willBookCourier = bookingIntent.kind === TRANSPORT_KIND.COURIER;
      const willBookTrucking = bookingIntent.kind === TRANSPORT_KIND.TRUCKING;

      if (allowLogisticsBook && willBookCourier && !isLogisticsDeliveryAddressComplete(logisticsDelivery)) {
        return res.status(400).json({
          status: 'error',
          message: `Order ${row.id}: complete delivery address with a 6-digit pincode is required for courier booking.`
        });
      }

      if (transportBookDebug && !willBookCourier && !willBookTrucking) {
        logger.info('[transport/confirm] logistics booking skipped (no courier / trucking selection)', {
          orderId: row.id,
          orderNumber: row.order_number
        });
      }

      rowContexts.push({
        row,
        pick,
        sp,
        tn,
        tu,
        tnotes,
        transportAmt,
        prevAddr,
        existingBill,
        existingTransport,
        currentTotal,
        productsOnly,
        courierCompanyId,
        vehicleTypeId,
        transportMode,
        transportSource,
        truckingWeightKg,
        pickupLat,
        pickupLng,
        deliveryLat,
        deliveryLng,
        truckingCarrier,
        truckingMatter,
        willBookCourier,
        willBookTrucking,
        allowLogisticsBook,
        orderPaid,
        bookingIntent,
        logisticsDelivery,
        lines: buildCourierLinesFromOrderItems(row.order_items),
        weightKg: computeOrderWeightKgForCourier(row.order_items),
        resolvedSp: String(sp).trim(),
        orderNotes: tnotes || null,
        logisticsBookingMeta: null,
        expectedDeliveryDate: row.expected_delivery_date || null,
        transitDays: Number.isFinite(transitDays) ? Math.trunc(transitDays) : null,
        transportGroupId,
        pickupPincode: pickupPincode.length === 6 ? pickupPincode : null,
        etdRaw: etdRaw ? String(etdRaw) : null
      });
    }

    // Book courier or trucking in parallel (multi-vendor PO confirm).
    // Upstream logistics book runs only after vault debit (payment_status=paid).
    const bookingWarnings = [];
    await Promise.all(
      rowContexts.map(async (ctx) => {
        const {
          row,
          bookingIntent,
          transportMode,
          transportSource,
          truckingWeightKg,
          sp,
          logisticsDelivery,
          lines,
          weightKg,
          truckingMatter,
          willBookCourier,
          willBookTrucking,
          allowLogisticsBook,
          orderPaid
        } = ctx;
        if (!willBookCourier && !willBookTrucking) return;

        if (!allowLogisticsBook) {
          ctx.logisticsBookingMeta = {
            mode: willBookCourier ? 'courier' : 'trucking',
            deferredUntilPayment: !orderPaid,
            alreadyBooked: orderPaid,
            trackingNumber: null,
            trackingUrl: null
          };
          if (!orderPaid) {
            bookingWarnings.push({
              orderId: row.id,
              orderNumber: row.order_number || null,
              message: 'Carrier booking deferred until vault payment succeeds'
            });
          }
          return;
        }

        try {
          if (willBookCourier) {
            const clientReference =
              ctx.transportGroupId ||
              row.order_number ||
              (row.id ? `tatva-order:${row.id}` : null);
            const useSchedule =
              ctx.expectedDeliveryDate &&
              ctx.transitDays != null &&
              ctx.pickupPincode;

            const booked = useSchedule
              ? await scheduleCourier({
                  courierCompanyId: bookingIntent.courierCompanyId,
                  courierDisplayName: String(sp).trim(),
                  deliveryAddress: logisticsDelivery,
                  sessionBuyer,
                  weightKg,
                  expectedDeliveryDate: ctx.expectedDeliveryDate,
                  transitDays: ctx.transitDays,
                  pickupPincode: ctx.pickupPincode,
                  orderId: row.id,
                  orderNumber: row.order_number || undefined,
                  clientReference,
                  etdRaw: ctx.etdRaw
                })
              : await bookCourierCheckout({
                  courierCompanyId: bookingIntent.courierCompanyId,
                  courierDisplayName: String(sp).trim(),
                  deliveryAddress: logisticsDelivery,
                  sessionBuyer,
                  lines,
                  weightKg,
                  orderId: row.id,
                  orderNumber: row.order_number || undefined,
                  vendorId: row.supplier_id || null,
                  clientReference
                });
            if (booked.trackingNumber) ctx.tn = booked.trackingNumber;
            if (booked.trackingUrl) ctx.tu = booked.trackingUrl;
            if (booked.shippingProvider) ctx.resolvedSp = booked.shippingProvider;

            ctx.logisticsBookingMeta = {
              mode: useSchedule ? 'schedule_courier' : 'courier',
              shipmentId: booked.shipmentId,
              shiprocketOrderId: booked.shiprocketOrderId,
              pendingReason: booked.pendingReason || null,
              usedLegacyCarrierBook: booked.usedLegacyCarrierBook || false,
              scheduledId: booked.scheduledId || null,
              dispatchDate: booked.dispatchDate || null,
              dispatchImmediately: booked.dispatchImmediately ?? null,
              logisticsOrderId: booked.logisticsOrderId || null,
              trackingNumber: booked.trackingNumber || null,
              trackingUrl: booked.trackingUrl || null,
              clientReference,
              ...(booked.debug ? { debug: booked.debug } : {})
            };

            if (transportBookDebug) {
              logger.info('[transport/confirm] courier booking result (before DB update)', {
                orderId: row.id,
                orderNumber: row.order_number,
                courierCompanyId: bookingIntent.courierCompanyId,
                tracking_number: ctx.tn,
                tracking_url: ctx.tu,
                shipping_provider: ctx.resolvedSp
              });
            }

            const diagParts = [];
            if (booked.pendingReason) diagParts.push(booked.pendingReason);
            if (booked.shipmentId) diagParts.push(`shipment_id ${booked.shipmentId}`);
            if (booked.shiprocketOrderId) diagParts.push(`shiprocket_order_id ${booked.shiprocketOrderId}`);
            if (diagParts.length > 0 && (!booked.trackingNumber || !booked.trackingUrl)) {
              const bit = diagParts.join(' · ');
              ctx.orderNotes = ctx.orderNotes ? `${ctx.orderNotes} | [Logistics] ${bit}` : `[Logistics] ${bit}`;
            }
            return;
          }

          const explicitTruckingWeight = Number(truckingWeightKg);
          const fallbackOrderWeight = Number(weightKg);
          const bookWeight =
            Number.isFinite(explicitTruckingWeight) && explicitTruckingWeight > 0
              ? explicitTruckingWeight
              : fallbackOrderWeight;
          if (!Number.isFinite(bookWeight) || bookWeight <= 0) {
            const err = new Error(
              `Order ${row.id}: Trucking requires a positive shipment weight. Add item weight in product specifications (e.g. "Weight: 25 kg"), re-create order, and retry transport confirmation.`
            );
            err.statusCode = 400;
            err.orderId = row.id;
            throw err;
          }
          const booked = await bookTrucking({
            vehicleTypeId: bookingIntent.vehicleTypeId,
            carrier: bookingIntent.carrier,
            pickupLat: bookingIntent.pickupLat,
            pickupLng: bookingIntent.pickupLng,
            deliveryLat: bookingIntent.deliveryLat,
            deliveryLng: bookingIntent.deliveryLng,
            contactPhone: sessionBuyer.phone,
            weightKg: bookWeight,
            matter: truckingMatter || lines.map((l) => l.name).filter(Boolean).join(', '),
            displayName: String(sp).trim()
          });
          if (booked.trackingNumber) ctx.tn = booked.trackingNumber;
          if (booked.trackingUrl) ctx.tu = booked.trackingUrl;
          if (booked.shippingProvider) ctx.resolvedSp = booked.shippingProvider;

          ctx.logisticsBookingMeta = {
            mode: 'trucking',
            borzoOrderId: booked.borzoOrderId,
            vehicleTypeId: bookingIntent.vehicleTypeId,
            transportMode: transportMode || 'trucking',
            source: transportSource || 'borzo',
            pendingReason: booked.pendingReason || null,
            trackingNumber: booked.trackingNumber || null,
            trackingUrl: booked.trackingUrl || null,
            ...(booked.debug ? { debug: booked.debug } : {})
          };

          if (transportBookDebug) {
            logger.info('[transport/confirm] trucking booking result (before DB update)', {
              orderId: row.id,
              orderNumber: row.order_number,
              vehicleTypeId: bookingIntent.vehicleTypeId,
              transportMode,
              source: transportSource,
              tracking_number: ctx.tn,
              tracking_url: ctx.tu,
              shipping_provider: ctx.resolvedSp
            });
          }

          if (booked.pendingReason && (!booked.trackingNumber || !booked.trackingUrl)) {
            const bit = booked.pendingReason;
            ctx.orderNotes = ctx.orderNotes ? `${ctx.orderNotes} | [Logistics] ${bit}` : `[Logistics] ${bit}`;
          }
        } catch (bookErr) {
          logger.error('Logistics booking error:', bookErr);
          const strictBook =
            String(process.env.LOGISTICS_BOOK_STRICT || '').toLowerCase() === 'true';
          const statusCode =
            bookErr?.code === 'LOGISTICS_VALIDATION'
              ? 400
              : Number(bookErr?.statusCode) >= 400 && Number(bookErr?.statusCode) < 600
                ? Number(bookErr.statusCode)
                : 502;
          const bookMessage = bookErr?.message || 'Transport booking failed';
          // Soft-fail by default: still save chosen carrier / quote on the order so
          // "Confirm & Create All POs" completes when logistics is misconfigured.
          if (strictBook || bookErr?.code === 'LOGISTICS_VALIDATION') {
            const err = new Error(bookMessage);
            err.statusCode = statusCode === 404 ? 502 : statusCode;
            err.orderId = row.id;
            throw err;
          }
          const pending = `[Booking pending] ${bookMessage}`;
          ctx.logisticsBookingMeta = {
            mode: willBookCourier ? 'courier' : 'trucking',
            bookingFailed: true,
            pendingReason: pending,
            httpStatus: statusCode,
            logisticsUrl: bookErr?.logisticsUrl || null
          };
          ctx.orderNotes = ctx.orderNotes ? `${ctx.orderNotes} | ${pending}` : pending;
          bookingWarnings.push({
            orderId: row.id,
            orderNumber: row.order_number || null,
            message: bookMessage
          });
        }
      })
    );

    const updatedOrders = await Promise.all(
      rowContexts.map(async (ctx) => {
        const {
          row,
          tn,
          tu,
          tnotes,
          transportAmt,
          prevAddr,
          existingBill,
          productsOnly,
          resolvedSp
        } = ctx;
        let nextDeliveryAddress = prevAddr;
        let nextTotalAmount = ctx.currentTotal;

        if (transportAmt !== null && transportAmt > 0) {
          const transportBill = {
            amount: transportAmt,
            currency: 'INR',
            provider: resolvedSp,
            confirmedAt: new Date().toISOString(),
            source: 'logistics_quote'
          };
          nextDeliveryAddress = { ...prevAddr, transportBill };
          nextTotalAmount = Math.round((productsOnly + transportAmt) * 100) / 100;
        } else if (existingBill) {
          nextDeliveryAddress = { ...prevAddr, transportBill: existingBill };
        }

        const history = Array.isArray(row.status_history) ? [...row.status_history] : [];
        history.push({
          status: 'confirmed',
          timestamp: new Date().toISOString(),
          updatedBy: req.userId,
          notes: `Transport selected: ${resolvedSp}${tnotes ? ` | ${tnotes}` : ''}${
            transportAmt !== null && transportAmt > 0 ? ` | Quoted transport: INR ${transportAmt}` : ''
          }`
        });

        const { data: updated, error: updateError } = await supabase
          .from('orders')
          .update({
            shipping_provider: resolvedSp,
            tracking_number: tn || null,
            tracking_url: tu || null,
            notes: ctx.orderNotes || null,
            transport_confirmed_at: new Date().toISOString(),
            status_history: history,
            delivery_address: nextDeliveryAddress,
            total_amount: nextTotalAmount
          })
          .eq('id', row.id)
          .eq('service_provider_id', req.userId)
          .select('id, order_number, shipping_provider, tracking_number, tracking_url, transport_confirmed_at, notes')
          .single();
        if (updateError) throw updateError;
        if (transportBookDebug) {
          logger.info('[transport/confirm] order row after DB update', {
            orderId: updated.id,
            orderNumber: updated.order_number,
            tracking_number: updated.tracking_number,
            tracking_url: updated.tracking_url,
            shipping_provider: updated.shipping_provider
          });
        }
        return {
          ...updated,
          ...(ctx.logisticsBookingMeta ? { logisticsBooking: ctx.logisticsBookingMeta } : {})
        };
      })
    );

    return res.json({
      status: 'success',
      message: `Transport details updated for ${updatedOrders.length} order(s)`,
      ...(transportBookDebug ? { transportDebugEnabled: true } : {}),
      orders: updatedOrders,
      ...(bookingWarnings.length > 0
        ? {
            warnings: bookingWarnings,
            message: `Transport details saved for ${updatedOrders.length} order(s). Carrier booking is pending for ${bookingWarnings.length} shipment(s) — tracking can be updated later.`
          }
        : {})
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    let httpStatus = Number(error?.statusCode);
    if (!Number.isFinite(httpStatus) || httpStatus < 400 || httpStatus >= 600) {
      httpStatus = 500;
    }
    // Avoid leaking upstream FastAPI 404 as "Not Found" on this API route.
    if (httpStatus === 404) httpStatus = 502;
    if (httpStatus >= 400 && httpStatus < 600 && httpStatus !== 500) {
      return res.status(httpStatus).json({
        status: 'error',
        message: error.message || 'Transport booking failed',
        orderId: error.orderId || undefined
      });
    }
    logger.error('Transport confirm error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to confirm transport details',
      error: error.message
    });
  }
});

}
