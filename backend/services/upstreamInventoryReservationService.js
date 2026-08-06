import {
  CHECKOUT_RESERVATION_MINUTES,
  CHECKOUT_SOURCES,
  computeAvailableStock,
  consumeCheckoutReservationsForOrder as consumeSharedCheckoutReservationsForOrder,
  getActiveReservedQuantitiesByProductIds,
  getCheckoutReservationStatus,
  releaseCheckoutReservations,
  reserveCheckoutLines,
  validateCheckoutReservationsForLines as validateSharedCheckoutReservationsForLines
} from './checkoutInventoryReservationService.js';

export {
  CHECKOUT_RESERVATION_MINUTES,
  CHECKOUT_RESERVATION_MINUTES as UPSTREAM_CHECKOUT_RESERVATION_MINUTES,
  computeAvailableStock,
  expireStaleReservations,
  getActiveReservedQuantitiesByProductIds
} from './checkoutInventoryReservationService.js';

export async function releaseUpstreamCheckoutReservations({
  buyerUserId,
  checkoutSessionId = null,
  actorUserId = null
}) {
  return releaseCheckoutReservations({
    buyerUserId,
    source: CHECKOUT_SOURCES.UPSTREAM,
    checkoutSessionId,
    actorUserId
  });
}

export async function reserveUpstreamCheckoutLines({ buyerUserId, checkoutSessionId, lines = [] }) {
  return reserveCheckoutLines({
    buyerUserId,
    source: CHECKOUT_SOURCES.UPSTREAM,
    checkoutSessionId,
    lines
  });
}

export async function getUpstreamCheckoutReservationStatus({ buyerUserId, checkoutSessionId }) {
  return getCheckoutReservationStatus({
    buyerUserId,
    source: CHECKOUT_SOURCES.UPSTREAM,
    checkoutSessionId
  });
}

export async function validateCheckoutReservationsForLines({
  buyerUserId,
  checkoutSessionId,
  lines = []
}) {
  return validateSharedCheckoutReservationsForLines({
    buyerUserId,
    source: CHECKOUT_SOURCES.UPSTREAM,
    checkoutSessionId,
    lines
  });
}

export async function consumeCheckoutReservationsForOrder({
  buyerUserId,
  checkoutSessionId,
  lines = [],
  orderItemBySupplierProductId = {},
  skipExpireStale = false
}) {
  return consumeSharedCheckoutReservationsForOrder({
    buyerUserId,
    source: CHECKOUT_SOURCES.UPSTREAM,
    checkoutSessionId,
    lines,
    orderItemBySupplierProductId,
    skipExpireStale
  });
}
