/**
 * Canonical sales / revenue recognition rules for the platform.
 * All dashboards, analytics, and pay-later gates should use these helpers.
 */

export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Paid order whose revenue counts toward net revenue (item-level, after closed returns). */
export function isRevenueRecognizedOrder(order) {
  const paymentStatus = String(order?.payment_status || order?.paymentStatus || '').toLowerCase();
  const status = String(order?.status || '').toLowerCase();
  return paymentStatus === 'paid' && status !== 'cancelled' && status !== 'returned';
}

/** @deprecated Use isRevenueRecognizedOrder */
export const isPaidRecognizedOrder = isRevenueRecognizedOrder;

/**
 * Lifetime pay-later unlock: prior paid net revenue (after returns) must already meet
 * the configured threshold. The current cart/order amount does not count — once the
 * buyer has crossed the threshold historically, any later order size may use pay later
 * (subject to credit limit / loan cycle).
 * ₹0 threshold = no lifetime gate.
 */
export function isPayLaterThresholdMet(_orderAmount, paylaterThreshold, priorNetRevenue = 0) {
  const threshold = roundMoney(paylaterThreshold);
  if (threshold <= 0) return true;
  return roundMoney(priorNetRevenue) + 0.009 >= threshold;
}

/**
 * Whether pay later should be offered / shown (aligned across Sales page, PO, POS).
 * `paylaterThreshold` is lifetime net-revenue unlock (₹0 = none). Credit limit still
 * caps outstanding. Buyers may be service providers or suppliers ordering upstream.
 */
export function computePayLaterOffered({
  hasAccount = false,
  isEnabled = true,
  creditLimit = 0,
  paylaterThreshold = 0,
  priorNetRevenue = 0,
  orderAmount = 0,
  hasCreditParty = false,
  buyerType = null
} = {}) {
  if (buyerType === 'walk_in') {
    return { payLaterOffered: false, payLaterThresholdMet: false, thresholdOptional: false };
  }

  const limit = roundMoney(creditLimit);
  const threshold = roundMoney(paylaterThreshold);
  const thresholdOptional = threshold <= 0;
  const payLaterThresholdMet = isPayLaterThresholdMet(orderAmount, threshold, priorNetRevenue);
  const payLaterOffered =
    Boolean(hasAccount) &&
    isEnabled !== false &&
    limit > 0 &&
    (thresholdOptional || payLaterThresholdMet) &&
    Boolean(hasCreditParty || hasAccount);

  return { payLaterOffered, payLaterThresholdMet, thresholdOptional };
}

/**
 * Remaining credit headroom before hitting the configured limit.
 */
export function computeRemainingCredit(creditLimit = 0, outstanding = 0) {
  const limit = roundMoney(creditLimit);
  const used = roundMoney(outstanding);
  return roundMoney(Math.max(0, limit - used));
}

/**
 * True when outstanding + this order stays at or below the credit limit (full limit usable).
 */
export function isWithinCreditLimit(outstanding = 0, orderAmount = 0, creditLimit = 0) {
  const limit = roundMoney(creditLimit);
  if (limit <= 0) return roundMoney(orderAmount) <= 0;
  const total = roundMoney(roundMoney(outstanding) + roundMoney(orderAmount));
  return total <= limit + 0.009;
}

/**
 * Loan cycle / credit limit gate for pay-later checkout.
 * Overdue outstanding must be settled before new pay-later orders.
 */
export function computePayLaterCycleLimitGate({
  cycleIsOverdue = false,
  outstanding = 0,
  creditLimit = 0,
  orderAmount = 0
} = {}) {
  const outstandingAmt = roundMoney(outstanding);
  const limit = roundMoney(creditLimit);
  const requested = roundMoney(orderAmount);
  const remainingCredit = computeRemainingCredit(limit, outstandingAmt);
  const cycleBlocksPayLater = Boolean(cycleIsOverdue) && outstandingAmt > 0;
  const exceedsCreditLimit = requested > 0 && !isWithinCreditLimit(outstandingAmt, requested, limit);
  return {
    cycleBlocksPayLater,
    exceedsCreditLimit,
    blocksPayLater: cycleBlocksPayLater || exceedsCreditLimit,
    remainingCredit,
    creditLimit: limit,
    outstanding: outstandingAmt,
    requested
  };
}

/**
 * Sales badge: credit account ready AND lifetime net-revenue threshold met (if any).
 */
export function computePayLaterEligibleForSales({
  creditLimit = 0,
  paylaterThreshold = 0,
  priorNetRevenue = 0,
  hasCreditParty = false,
  buyerType = null
} = {}) {
  const hasAccount = roundMoney(creditLimit) > 0;
  const { payLaterOffered, payLaterThresholdMet } = computePayLaterOffered({
    hasAccount,
    isEnabled: true,
    creditLimit,
    paylaterThreshold,
    priorNetRevenue,
    orderAmount: 0,
    hasCreditParty,
    buyerType
  });
  return { payLaterEligible: payLaterOffered, payLaterThresholdMet };
}
