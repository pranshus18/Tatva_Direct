function toInr(value, { assumePaise = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return assumePaise ? numeric / 100 : numeric;
}

function unwrapPmPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  return payload;
}

function resolveVaultRecord(vaultPayload) {
  const unwrapped = unwrapPmPayload(vaultPayload) || {};
  if (Array.isArray(unwrapped)) {
    return unwrapped[0] && typeof unwrapped[0] === 'object' ? unwrapped[0] : {};
  }
  if (unwrapped.vault && typeof unwrapped.vault === 'object') return unwrapped.vault;
  if (unwrapped.wallet && typeof unwrapped.wallet === 'object') return unwrapped.wallet;
  return unwrapped;
}

function resolveVaultBalanceInr(vault) {
  if (!vault || typeof vault !== 'object') return 0;

  const paiseCandidate =
    vault.balanceInPaise ??
    vault.availableBalanceInPaise ??
    vault.walletBalanceInPaise ??
    vault.totalBalanceInPaise ??
    null;
  if (paiseCandidate !== null && paiseCandidate !== undefined) {
    return toInr(paiseCandidate, { assumePaise: true });
  }

  return toInr(
    vault.balance ??
      vault.availableBalance ??
      vault.walletBalance ??
      vault.currentBalance ??
      vault.totalBalance ??
      vault.availableAmount ??
      vault.amount ??
      0
  );
}

function resolveVaultHoldingInr(vault) {
  if (!vault || typeof vault !== 'object') return 0;

  const paiseCandidate =
    vault.holdingAmountInPaise ??
    vault.holdingBalanceInPaise ??
    vault.lockedBalanceInPaise ??
    null;
  if (paiseCandidate !== null && paiseCandidate !== undefined) {
    return toInr(paiseCandidate, { assumePaise: true });
  }

  const holdingCandidate =
    vault.holdingAmount ??
    vault.holdingBalance ??
    vault.lockedBalance ??
    vault.blockedBalance ??
    vault.escrowBalance ??
    null;
  if (holdingCandidate !== null && holdingCandidate !== undefined) {
    return toInr(holdingCandidate);
  }

  const total = toInr(vault.totalBalance ?? vault.balance ?? 0);
  const available = resolveVaultBalanceInr(vault);
  return total > available + 0.0001 ? total - available : 0;
}

function mapPmVaultTransactions(vault) {
  const rows = Array.isArray(vault?.transactions)
    ? vault.transactions
    : Array.isArray(vault?.ledger)
      ? vault.ledger
      : Array.isArray(vault?.history)
        ? vault.history
        : [];

  return rows.map((entry, index) => {
    const rawDir = String(
      entry?.direction || entry?.type || entry?.transactionType || ''
    ).toLowerCase();
    const direction =
      rawDir.includes('credit') || rawDir === 'cr' || rawDir === 'in' ? 'credit' : 'debit';
    const amount = toInr(Math.abs(Number(entry?.amount ?? entry?.value ?? 0)));

    return {
      id: String(entry?._id || entry?.id || entry?.transactionId || `pm-txn-${index}`),
      created_at:
        entry?.createdAt ||
        entry?.created_at ||
        entry?.timestamp ||
        entry?.date ||
        new Date().toISOString(),
      description: String(entry?.description || entry?.note || entry?.purpose || 'Vault transaction'),
      transaction_type: String(entry?.transactionType || entry?.type || 'vault'),
      direction,
      amount,
      balance_after: toInr(entry?.balanceAfter ?? entry?.balance_after ?? entry?.closingBalance ?? 0),
      orderId: entry?.orderId || entry?.order_id || null,
      orderNumber: entry?.orderNumber || entry?.order_number || null,
      source: 'pm_vault'
    };
  });
}

function summarizePmVaultLedger(transactions = []) {
  return transactions.reduce(
    (acc, row) => {
      const amount = Number(row.amount || 0);
      if (row.direction === 'credit') acc.totalCredit += amount;
      else acc.totalDebit += amount;
      acc.transactionCount += 1;
      return acc;
    },
    { totalCredit: 0, totalDebit: 0, transactionCount: 0, netFlow: 0 }
  );
}

export function mapPmVaultPayload(vaultPayload) {
  const vault = resolveVaultRecord(vaultPayload) || {};
  const balance = resolveVaultBalanceInr(vault);
  const holdingAmount = resolveVaultHoldingInr(vault);
  const transactions = mapPmVaultTransactions(vault);
  const summary = summarizePmVaultLedger(transactions);
  summary.netFlow = summary.totalCredit - summary.totalDebit;

  const vaultView = {
    id: String(vault?._id || vault?.id || vault?.vaultId || 'pm-vault'),
    balance,
    holdingAmount,
    currency: String(vault?.currency || 'INR'),
    source: 'pm_vault',
    status: String(vault?.status || 'active')
  };

  return {
    vault: vaultView,
    balance,
    holdingAmount,
    transactions,
    summary,
    source: 'pm_vault'
  };
}

export function mapPmTopupInitiatePayload(payload) {
  const data = unwrapPmPayload(payload) || {};
  const razorpay = data.razorpay || data.checkout || data.paymentIntent || data.payment || {};
  const orderId =
    data.razorpay_order_id ||
    data.razorpayOrderId ||
    razorpay.order_id ||
    razorpay.orderId ||
    razorpay.id ||
    data.orderId ||
    data.order_id ||
    null;
  const keyId =
    data.razorpay_key_id ||
    data.razorpayKeyId ||
    razorpay.key_id ||
    razorpay.keyId ||
    razorpay.key ||
    data.keyId ||
    data.key_id ||
    null;
  const orderAmount = data.amount ?? data.orderAmount ?? razorpay.amount ?? null;

  if (!orderId || !keyId) {
    throw new Error('Vault top-up did not return Razorpay checkout details from PM.');
  }

  return {
    provider: 'razorpay',
    orderId,
    keyId,
    amount: Number(orderAmount),
    currency: String(data.currency || 'INR')
  };
}
