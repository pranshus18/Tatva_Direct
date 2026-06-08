import { computeGroupWeightKg } from '../controllers/logisticsController.js';

/** Map order.delivery_address JSON → Tatva logistics BookCourierAddress shape. */
export function orderDeliveryJsonToLogisticsAddress(addr = {}) {
  const a = addr && typeof addr === 'object' ? addr : {};
  const pin = String(a.pincode || a.zipCode || '').replace(/\D/g, '').slice(0, 6);
  return {
    line1: String(a.line1 || a.street || '').trim(),
    city: String(a.city || '').trim(),
    state: String(a.state || '').trim(),
    country: String(a.country || 'India').trim() || 'India',
    pincode: pin
  };
}

/** BookCourierAddress required fields (openapi BookCourierCheckoutRequest). */
export function isLogisticsDeliveryAddressComplete(a) {
  return (
    String(a?.line1 || '').trim().length > 0 &&
    String(a?.city || '').trim().length > 0 &&
    String(a?.state || '').trim().length > 0 &&
    String(a?.pincode || '').replace(/\D/g, '').length === 6
  );
}

export function buildCourierLinesFromOrderItems(orderItems) {
  return (Array.isArray(orderItems) ? orderItems : []).map((row) => {
    let specs = {};
    try {
      if (row.specifications && typeof row.specifications === 'string') {
        specs = JSON.parse(row.specifications);
      } else if (row.specifications && typeof row.specifications === 'object' && row.specifications) {
        specs = row.specifications;
      }
    } catch {
      specs = {};
    }
    const name =
      (row.product && row.product.name) ||
      specs.brandModel ||
      specs.name ||
      'Item';
    return {
      product_id: row.product_id,
      name: String(name).slice(0, 300),
      quantity: Number(row.quantity) || 0,
      unit_price: Number(row.unit_price) || 0,
      total_price: Number(row.total_price) || 0,
      sku: specs.sku || specs.skuNo || specs.gsku || null
    };
  });
}

export function computeOrderWeightKgForCourier(orderItems) {
  const items = (Array.isArray(orderItems) ? orderItems : []).map((row) => {
    let specs = {};
    try {
      if (row.specifications && typeof row.specifications === 'string') {
        specs = JSON.parse(row.specifications);
      } else if (row.specifications && typeof row.specifications === 'object' && row.specifications) {
        specs = row.specifications;
      }
    } catch {
      specs = {};
    }
    return { quantity: row.quantity, specifications: specs };
  });
  return computeGroupWeightKg({ items });
}
