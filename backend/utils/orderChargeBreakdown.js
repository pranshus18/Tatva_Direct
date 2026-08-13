import { roundMoney } from './money.js';

/** MRP line total for a PO group (GST already included in unit prices). */
export function resolvePoGroupMrpTotal(group = {}) {
  const mrp = Number(
    group?.totalInclGst ?? group?.gstSummary?.totalAmount ?? group?.subtotal ?? group?.total
  );
  return Number.isFinite(mrp) ? roundMoney(mrp) : 0;
}

/** Taxable value (excl. GST) extracted from MRP for invoice breakdown. */
export function resolvePoGroupTaxableSubtotal(group = {}) {
  const taxable = Number(group?.gstSummary?.subtotalAmount);
  if (Number.isFinite(taxable) && taxable >= 0) return roundMoney(taxable);
  const mrp = resolvePoGroupMrpTotal(group);
  const gst = Number(group?.gstAmount ?? group?.gstSummary?.taxAmount) || 0;
  return roundMoney(Math.max(0, mrp - gst));
}

export function sumPoGroupsProductsInclGst(poGroups = []) {
  return roundMoney(
    (Array.isArray(poGroups) ? poGroups : []).reduce(
      (sum, group) => sum + resolvePoGroupMrpTotal(group),
      0
    )
  );
}

export function sumPoGroupsGstAmount(poGroups = []) {
  return roundMoney(
    (Array.isArray(poGroups) ? poGroups : []).reduce(
      (sum, group) => sum + (Number(group?.gstAmount ?? group?.gstSummary?.taxAmount) || 0),
      0
    )
  );
}

export function sumPoGroupsProductSubtotal(poGroups = []) {
  return roundMoney(
    (Array.isArray(poGroups) ? poGroups : []).reduce(
      (sum, group) => sum + resolvePoGroupTaxableSubtotal(group),
      0
    )
  );
}

/**
 * Order charge split:
 * - buyerVaultDebit: products (MRP incl. GST) — debited from the SP PM vault
 * - logisticsVaultDebit: transport — debited from the logistics vault at carrier booking
 * - combinedTotal: full order total (products + transport) for invoices and display
 */
export function resolveOrderChargeBreakdown(order = {}) {
  const delivery = order?.delivery_address || order?.deliveryAddress || {};
  const gst =
    delivery?.gstSummary ||
    order?.invoice?.metadata?.gstSummary ||
    order?.gstSummary ||
    null;
  let transportAmount = roundMoney(delivery?.transportBill?.amount || 0);
  const transportBill = delivery?.transportBill;
  if (
    transportBill &&
    (transportBill.source === 'self_ship' ||
      transportBill.paymentVault === 'none' ||
      transportBill.paymentStatus === 'not_applicable')
  ) {
    transportAmount = 0;
  }
  const storedTotal = roundMoney(order?.total_amount ?? order?.totalAmount ?? 0);

  const productSubtotal = roundMoney(gst?.subtotalAmount ?? 0);
  const gstAmount = roundMoney(gst?.taxAmount ?? 0);
  let productsInclGst = roundMoney(gst?.totalAmount ?? 0);

  if (!productsInclGst && storedTotal > 0) {
    productsInclGst = roundMoney(Math.max(0, storedTotal - transportAmount));
  }
  if (!productsInclGst && gst?.priceIncludesGst !== false && (productSubtotal || gstAmount)) {
    productsInclGst = roundMoney(productSubtotal + gstAmount);
  }

  if (!productsInclGst) {
    const items = Array.isArray(order?.order_items)
      ? order.order_items
      : Array.isArray(order?.items)
        ? order.items
        : [];
    productsInclGst = roundMoney(
      items.reduce(
        (sum, item) => sum + (Number(item?.total_price ?? item?.totalPrice) || 0),
        0
      )
    );
  }

  const derivedTotal = roundMoney(productsInclGst + transportAmount);
  let combinedTotal = storedTotal > 0 ? storedTotal : derivedTotal;

  // Legacy ex-GST orders: total_amount was taxable only; add GST from summary.
  if (
    gst?.priceIncludesGst === false &&
    gstAmount > 0 &&
    productSubtotal > 0 &&
    Math.abs(storedTotal - productSubtotal) < 0.01
  ) {
    combinedTotal = derivedTotal;
  } else if (storedTotal <= 0 && derivedTotal > 0) {
    combinedTotal = derivedTotal;
  } else if (derivedTotal > storedTotal + 0.01) {
    // Stored total missing freight (common before transport confirm) or stale — use full charge.
    combinedTotal = derivedTotal;
  }

  const buyerVaultDebit = productsInclGst;
  const logisticsVaultDebit = transportAmount;

  return {
    productSubtotal: productSubtotal || roundMoney(Math.max(0, productsInclGst - gstAmount)),
    gstAmount,
    productsInclGst,
    transportAmount,
    buyerVaultDebit,
    logisticsVaultDebit,
    combinedTotal,
    gstSummary: gst
  };
}
