const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function sumPoGroupsProductsInclGst(poGroups = []) {
  return roundMoney(
    (Array.isArray(poGroups) ? poGroups : []).reduce((sum, group) => {
      const incl = Number(group?.totalInclGst ?? group?.gstSummary?.totalAmount);
      if (Number.isFinite(incl) && incl > 0) return sum + incl;
      const sub = Number(group?.subtotal ?? group?.total) || 0;
      const gst = Number(group?.gstAmount) || 0;
      return sum + sub + gst;
    }, 0)
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
      (sum, group) =>
        sum + (Number(group?.subtotal ?? group?.gstSummary?.subtotalAmount ?? group?.total) || 0),
      0
    )
  );
}

export function resolveOrderChargeBreakdown(order = {}) {
  const delivery = order?.deliveryAddress || order?.delivery_address || {};
  const gst =
    delivery?.gstSummary ||
    order?.invoice?.metadata?.gstSummary ||
    order?.gstSummary ||
    null;
  const transportAmount = roundMoney(delivery?.transportBill?.amount || 0);

  const productSubtotal = roundMoney(gst?.subtotalAmount ?? 0);
  const gstAmount = roundMoney(gst?.taxAmount ?? 0);
  let productsInclGst = roundMoney(gst?.totalAmount ?? 0);

  if (!productsInclGst && (productSubtotal || gstAmount)) {
    productsInclGst = roundMoney(productSubtotal + gstAmount);
  }

  if (!productsInclGst) {
    const items = Array.isArray(order?.items) ? order.items : [];
    productsInclGst = roundMoney(
      items.reduce((sum, item) => sum + (Number(item?.totalPrice ?? item?.total_price) || 0), 0)
    );
  }

  const storedTotal = roundMoney(order?.totalAmount ?? order?.total_amount ?? 0);
  let combinedTotal = roundMoney(productsInclGst + transportAmount);

  if (
    gstAmount > 0 &&
    productSubtotal > 0 &&
    Math.abs(storedTotal - productSubtotal) < 0.01
  ) {
    combinedTotal = roundMoney(productsInclGst + transportAmount);
  } else if (storedTotal > combinedTotal + 0.01) {
    combinedTotal = storedTotal;
  } else if (!gst && storedTotal > 0) {
    combinedTotal = storedTotal;
  }

  return {
    productSubtotal: productSubtotal || roundMoney(Math.max(0, productsInclGst - gstAmount)),
    gstAmount,
    productsInclGst,
    transportAmount,
    combinedTotal,
    gstSummary: gst
  };
}
