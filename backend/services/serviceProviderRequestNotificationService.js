/**
 * Service Provider product-request lifecycle notifications.
 * BOQ requests are stored in product_requests; catalog products may also carry
 * requested_by_service_provider_id for approve/reject/fulfill alerts.
 */
import { insertNotification, insertNotifications } from '../repositories/notificationsRepository.js';
import { normalizeBoqProductRequestName } from './boqProductRequestDedupService.js';

const OPEN_BOQ_REQUEST_STATUSES = ['new', 'in_review', 'needs_info'];

export async function notifyServiceProviderProductRequestSubmitted({
  db,
  userId,
  productName,
  requestId = null,
  category = null,
  unit = null,
  brand = null,
  boqId = null
}) {
  if (!userId || !productName) return { error: null };

  return insertNotification(
    {
      user_id: userId,
      type: 'system',
      title: `Product request submitted: ${productName}`,
      message: `Your request for "${productName}" was submitted. Suppliers have been notified and you will get updates when the request status changes or a supplier adds the product.`,
      related_product_id: null,
      metadata: {
        productName,
        productCategory: category,
        productUnit: unit,
        brandName: brand,
        boqId,
        requestId,
        source: 'service_provider_product_request'
      },
      is_read: false
    },
    db,
    { skipEmail: true }
  );
}

export async function notifyServiceProviderRequestReviewDecision({
  db,
  request,
  decision
}) {
  const userId = request?.requested_by;
  if (!userId) return { notified: false };

  // Only BOQ (and manual) SP-originated requests belong in the SP inbox.
  const source = String(request?.source || '').trim().toLowerCase();
  if (source === 'supplier') return { notified: false };

  const normalized = request?.normalized_input && typeof request.normalized_input === 'object'
    ? request.normalized_input
    : {};
  const productName =
    String(normalized.name || '').trim() ||
    String(request?.category || 'your product').trim();

  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (normalizedDecision !== 'approved' && normalizedDecision !== 'rejected') {
    return { notified: false };
  }

  const isApproved = normalizedDecision === 'approved';
  await insertNotification(
    {
      user_id: userId,
      type: 'system',
      title: isApproved
        ? `Your product request was approved: ${productName}`
        : `Your product request was rejected: ${productName}`,
      message: isApproved
        ? `Your request for "${productName}" was approved${request?.review_notes ? `: ${request.review_notes}` : '.'}`
        : `Your request for "${productName}" was rejected${request?.review_notes ? `: ${request.review_notes}` : '.'}`,
      related_product_id: request?.resolved_product_id || null,
      metadata: {
        productName,
        requestId: request?.id || null,
        productId: request?.resolved_product_id || null,
        decision: normalizedDecision,
        source: isApproved
          ? 'service_provider_request_approved'
          : 'service_provider_request_rejected'
      },
      is_read: false
    },
    db,
    { skipEmail: true }
  );

  return { notified: true };
}

function requestNameMatchesProduct(request, productNameNorm, productBrandNorm) {
  const normalized = request?.normalized_input && typeof request.normalized_input === 'object'
    ? request.normalized_input
    : {};
  const requestName = normalizeBoqProductRequestName(normalized.name);
  if (!requestName || requestName !== productNameNorm) return false;

  const requestBrand = normalizeBoqProductRequestName(normalized.brand);
  if (requestBrand && productBrandNorm && requestBrand !== productBrandNorm) return false;
  return true;
}

/**
 * Find open BOQ product requests matching a catalog product and notify those SPs
 * that a supplier fulfilled their request. Optionally stamp the product with
 * requested_by_service_provider_id for later admin approve/reject alerts.
 */
export async function notifyServiceProvidersForFulfilledBoqRequests({
  db,
  product,
  supplier = null,
  alreadyNotifiedUserId = null
}) {
  const productId = product?.id;
  const productName = String(product?.name || '').trim();
  if (!productId || !productName) return { notifiedCount: 0, matchedRequestIds: [] };

  const productNameNorm = normalizeBoqProductRequestName(productName);
  const productBrandNorm = normalizeBoqProductRequestName(product?.brand);

  const { data: openRequests, error } = await db
    .from('product_requests')
    .select('id, requested_by, normalized_input, status, source')
    .eq('source', 'boq')
    .in('status', OPEN_BOQ_REQUEST_STATUSES)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) throw error;

  const matches = (openRequests || []).filter((request) =>
    requestNameMatchesProduct(request, productNameNorm, productBrandNorm)
  );

  if (!matches.length) return { notifiedCount: 0, matchedRequestIds: [] };

  const supplierLabel =
    String(supplier?.name || '').trim() ||
    String(supplier?.company || '').trim() ||
    'A supplier';

  const skipUserId = alreadyNotifiedUserId ? String(alreadyNotifiedUserId) : null;
  const notifications = [];
  const notifiedUserIds = new Set();

  for (const request of matches) {
    const userId = request.requested_by;
    if (!userId || (skipUserId && String(userId) === skipUserId)) continue;
    if (notifiedUserIds.has(String(userId))) continue;
    notifiedUserIds.add(String(userId));

    notifications.push({
      user_id: userId,
      type: 'system',
      title: `Supplier added your requested product: ${productName}`,
      message: `${supplierLabel} added "${productName}".`,
      related_product_id: productId,
      related_supplier_id: supplier?.id || null,
      metadata: {
        productId,
        requestId: request.id,
        productName,
        source: 'service_provider_request_fulfilled'
      },
      is_read: false
    });
  }

  if (notifications.length) {
    await insertNotifications(notifications, db, { skipEmail: true });
  }

  const matchedRequestIds = matches.map((r) => r.id).filter(Boolean);
  if (matchedRequestIds.length) {
    await db
      .from('product_requests')
      .update({
        status: 'merged',
        resolved_product_id: productId
      })
      .in('id', matchedRequestIds);
  }

  // Stamp catalog product so admin approve/reject can still notify the original SP.
  if (!product.requested_by_service_provider_id && matches[0]?.requested_by) {
    await db
      .from('products')
      .update({ requested_by_service_provider_id: matches[0].requested_by })
      .eq('id', productId)
      .is('requested_by_service_provider_id', null);
  }

  return { notifiedCount: notifications.length, matchedRequestIds };
}
