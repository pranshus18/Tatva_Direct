/** PO routes: transport */
import {
  bookCourierCheckout,
  bookTrucking,
  getContractErrorMessage,
  logger,
  parseWithSchema,
  poTransportConfirmSchema
} from './poImports.js';

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

    const rowContexts = [];
    for (const row of orders || []) {
      const pick = transportByOrderId.get(row.id);
      const sp = pick?.shippingProvider || shippingProvider;
      let tn = pick?.trackingNumber ?? trackingNumber;
      let tu = pick?.trackingUrl ?? trackingUrl;
      const tnotes = pick?.transportNotes ?? transportNotes;
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
      const productsOnly = Math.max(0, Math.round((currentTotal - existingTransport) * 100) / 100);

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

      const logisticsDelivery = orderDeliveryJsonToLogisticsAddress(prevAddr);
      const willBookCourier =
        courierCompanyId != null && Number.isFinite(Number(courierCompanyId));
      const willBookTrucking =
        !willBookCourier &&
        (transportMode === 'trucking' ||
          transportSource === 'borzo' ||
          (vehicleTypeId != null && Number.isFinite(Number(vehicleTypeId))));

      if (willBookCourier && !isLogisticsDeliveryAddressComplete(logisticsDelivery)) {
        return res.status(400).json({
          status: 'error',
          message: `Order ${row.id}: complete delivery address with a 6-digit pincode is required for courier booking.`
        });
      }

      if (willBookTrucking) {
        const plat = Number(pickupLat);
        const plng = Number(pickupLng);
        const dlat = Number(deliveryLat);
        const dlng = Number(deliveryLng);
        if (![plat, plng, dlat, dlng].every((n) => Number.isFinite(n))) {
          return res.status(400).json({
            status: 'error',
            message: `Order ${row.id}: pickup and delivery coordinates are required for trucking (Borzo) booking. Re-open Transport suggestion and pick a trucking quote.`
          });
        }
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
        logisticsDelivery,
        lines: buildCourierLinesFromOrderItems(row.order_items),
        weightKg: computeOrderWeightKgForCourier(row.order_items),
        resolvedSp: String(sp).trim(),
        orderNotes: tnotes || null,
        logisticsBookingMeta: null
      });
    }

    // Book courier or trucking in parallel (multi-vendor PO confirm).
    await Promise.all(
      rowContexts.map(async (ctx) => {
        const {
          row,
          courierCompanyId,
          vehicleTypeId,
          transportMode,
          transportSource,
          truckingWeightKg,
          sp,
          logisticsDelivery,
          lines,
          weightKg,
          pickupLat,
          pickupLng,
          deliveryLat,
          deliveryLng,
          truckingCarrier,
          truckingMatter,
          willBookCourier,
          willBookTrucking
        } = ctx;
        if (!willBookCourier && !willBookTrucking) return;

        try {
          if (willBookCourier) {
            const booked = await bookCourierCheckout({
              courierCompanyId: Number(courierCompanyId),
              courierDisplayName: String(sp).trim(),
              deliveryAddress: logisticsDelivery,
              sessionBuyer,
              lines,
              weightKg,
              orderId: row.id,
              orderNumber: row.order_number || undefined,
              vendorId: row.supplier_id || null
            });
            if (booked.trackingNumber) ctx.tn = booked.trackingNumber;
            if (booked.trackingUrl) ctx.tu = booked.trackingUrl;
            if (booked.shippingProvider) ctx.resolvedSp = booked.shippingProvider;

            ctx.logisticsBookingMeta = {
              mode: 'courier',
              shipmentId: booked.shipmentId,
              shiprocketOrderId: booked.shiprocketOrderId,
              pendingReason: booked.pendingReason || null,
              usedLegacyCarrierBook: booked.usedLegacyCarrierBook,
              trackingNumber: booked.trackingNumber || null,
              trackingUrl: booked.trackingUrl || null,
              ...(booked.debug ? { debug: booked.debug } : {})
            };

            if (transportBookDebug) {
              logger.info('[transport/confirm] courier booking result (before DB update)', {
                orderId: row.id,
                orderNumber: row.order_number,
                courierCompanyId: Number(courierCompanyId),
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

          const bookWeight =
            Number(truckingWeightKg) > 0 ? Number(truckingWeightKg) : weightKg;
          const vid =
            vehicleTypeId != null && Number.isFinite(Number(vehicleTypeId))
              ? Number(vehicleTypeId)
              : null;
          const booked = await bookTrucking({
            vehicleTypeId: vid,
            carrier: truckingCarrier || (transportSource === 'borzo' ? 'Borzo' : 'Borzo'),
            pickupLat,
            pickupLng,
            deliveryLat,
            deliveryLng,
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
            vehicleTypeId: vid,
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
              vehicleTypeId: vid,
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
          const statusCode =
            Number(bookErr?.statusCode) >= 400 && Number(bookErr?.statusCode) < 600
              ? Number(bookErr.statusCode)
              : 502;
          const err = new Error(bookErr?.message || 'Transport booking failed');
          err.statusCode = statusCode;
          err.orderId = row.id;
          throw err;
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
      orders: updatedOrders
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    const httpStatus = Number(error?.statusCode);
    if (Number.isFinite(httpStatus) && httpStatus >= 400 && httpStatus < 600) {
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
