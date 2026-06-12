import { supabase } from '../config/supabase.js';
import { recordPaymentLedger } from './ledgerService.js';
import { ensurePaymentTransactionForPaidOrder } from './paymentTransactionService.js';
import { createReceiptIfMissing } from './paymentReceiptService.js';

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function issueKey(orderId, issueType) {
  return `${orderId}:${issueType}`;
}

function computeSuccessRate(checked, ordersWithIssues) {
  if (!checked) return 100;
  return Number((((checked - ordersWithIssues) / checked) * 100).toFixed(2));
}

function partyLabel(party) {
  if (!party) return '';
  return party.company || party.name || '';
}

function indexByOrderId(rows = [], key = 'order_id') {
  const map = new Map();
  for (const row of rows) {
    if (row?.[key]) map.set(row[key], row);
  }
  return map;
}

function groupLedgerByOrderId(rows = [], receiptsByOrder = new Map()) {
  const receiptIdToOrderId = new Map();
  for (const [orderId, receipt] of receiptsByOrder.entries()) {
    if (receipt?.id) receiptIdToOrderId.set(receipt.id, orderId);
  }

  const map = new Map();
  for (const row of rows) {
    const orderId = row?.metadata?.orderId || receiptIdToOrderId.get(row?.reference_id);
    if (!orderId) continue;
    if (!map.has(orderId)) map.set(orderId, []);
    map.get(orderId).push(row);
  }
  return map;
}

function buildLineIssues(order, receipt, txn, ledgerRows) {
  const issues = [];
  if (!receipt) {
    issues.push({
      order_id: order.id,
      issue_type: 'missing_receipt',
      severity: 'high',
      expected_value: { payment_status: 'paid' },
      actual_value: { receipt: null }
    });
  }
  if (!txn) {
    issues.push({
      order_id: order.id,
      issue_type: 'missing_payment_txn',
      severity: 'high',
      expected_value: { payment_status: 'paid' },
      actual_value: { payment_transaction: null }
    });
  }
  if (receipt && Math.abs(toNumber(receipt.amount) - toNumber(order.total_amount)) > 0.01) {
    issues.push({
      order_id: order.id,
      issue_type: 'amount_mismatch',
      severity: 'high',
      expected_value: { orderTotal: order.total_amount },
      actual_value: { receiptAmount: receipt.amount }
    });
  }
  if (!ledgerRows || ledgerRows.length === 0) {
    issues.push({
      order_id: order.id,
      issue_type: 'ledger_mismatch',
      severity: 'medium',
      expected_value: { ledgerEntry: 'present' },
      actual_value: { ledgerEntry: 'missing' }
    });
  }
  return issues;
}

function buildLineFromOrder(order, receipt, txn, ledgerRows) {
  const orderTotal = toNumber(order.total_amount);
  const receiptAmount = receipt ? toNumber(receipt.amount) : null;
  const transactionAmount = txn ? toNumber(txn.amount) : null;
  const ledgerAmount = ledgerRows?.[0]?.amount ? toNumber(ledgerRows[0].amount) : null;
  const issues = buildLineIssues(order, receipt, txn, ledgerRows);

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    orderTotal,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method || null,
    paymentProvider: order.payment_provider || null,
    orderDate: order.created_at,
    serviceProvider: partyLabel(order.service_provider),
    supplier: partyLabel(order.supplier),
    receipt: receipt
      ? {
          present: true,
          id: receipt.id,
          number: receipt.receipt_number,
          amount: receiptAmount,
          paidAt: receipt.paid_at,
          paymentReference: receipt.payment_reference || null
        }
      : { present: false },
    transaction: txn
      ? {
          present: true,
          id: txn.id,
          amount: transactionAmount,
          status: txn.status,
          method: txn.method,
          providerPaymentId: txn.provider_payment_id || null
        }
      : { present: false },
    ledger: {
      present: Boolean(ledgerRows && ledgerRows.length > 0),
      amount: ledgerAmount
    },
    varianceOrderReceipt:
      receiptAmount == null ? null : Number((orderTotal - receiptAmount).toFixed(2)),
    varianceOrderTransaction:
      transactionAmount == null ? null : Number((orderTotal - transactionAmount).toFixed(2)),
    issueTypes: issues.map((i) => i.issue_type),
    status: issues.length ? 'mismatch' : 'matched',
    issues
  };
}

function summarizeLines(lines = []) {
  const allIssues = lines.flatMap((line) => line.issues || []);
  const ordersWithIssues = new Set(allIssues.map((i) => i.order_id)).size;
  const checked = lines.length;

  return {
    checked,
    matched: checked - ordersWithIssues,
    mismatches: ordersWithIssues,
    issueCount: allIssues.length,
    successRatePct: computeSuccessRate(checked, ordersWithIssues),
    totalOrderAmount: Number(lines.reduce((sum, line) => sum + toNumber(line.orderTotal), 0).toFixed(2)),
    totalReceiptAmount: Number(
      lines.reduce((sum, line) => sum + (line.receipt?.present ? toNumber(line.receipt.amount) : 0), 0).toFixed(2)
    ),
    totalTransactionAmount: Number(
      lines.reduce((sum, line) => sum + (line.transaction?.present ? toNumber(line.transaction.amount) : 0), 0).toFixed(2)
    ),
    totalLedgerAmount: Number(
      lines.reduce((sum, line) => sum + (line.ledger?.present ? toNumber(line.ledger.amount) : 0), 0).toFixed(2)
    ),
    issues: allIssues
  };
}

async function createRun({ runType, fromDate, toDate, actorUserId }) {
  const { data, error } = await supabase
    .from('reconciliation_runs')
    .insert({
      run_type: runType,
      from_date: fromDate || null,
      to_date: toDate || null,
      status: 'running',
      created_by: actorUserId || null
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function backfillPaidOrderRecords(order) {
  if (String(order.payment_status || '').toLowerCase() !== 'paid') {
    return { receiptBackfilled: false, txnBackfilled: false, ledgerBackfilled: false };
  }

  let receiptBackfilled = false;
  let txnBackfilled = false;
  let ledgerBackfilled = false;

  try {
    const { receipt, created } = await createReceiptIfMissing({
      order,
      paymentMethod: order.payment_method,
      paymentReference: order.payment_provider_payment_id,
      paidAt: order.payment_verified_at
    });
    receiptBackfilled = Boolean(created && receipt);

    const txnResult = await ensurePaymentTransactionForPaidOrder({
      order,
      method: order.payment_method,
      paymentReference: order.payment_provider_payment_id,
      paidAt: order.payment_verified_at,
      provider: order.payment_provider || 'manual'
    });
    txnBackfilled = Boolean(txnResult?.created);

    const activeReceipt = receipt || (await supabase.from('payment_receipts').select('*').eq('order_id', order.id).maybeSingle()).data;
    if (activeReceipt) {
      const { data: ledgerRows } = await supabase
        .from('ledger_entries')
        .select('id')
        .eq('reference_type', 'payment_receipt')
        .eq('reference_id', activeReceipt.id)
        .limit(1);
      if (!ledgerRows?.length) {
        await recordPaymentLedger({ receipt: activeReceipt, order });
        ledgerBackfilled = true;
      }
    }
  } catch (error) {
    console.error('[Reconciliation] backfill failed for order', order.id, error?.message || error);
  }

  return { receiptBackfilled, txnBackfilled, ledgerBackfilled };
}

function formatInr(amount) {
  return `INR ${toNumber(amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function describeReconciliationIssue(issue, order) {
  const orderLabel = order?.order_number || 'Unknown order';
  const orderAmount = order?.total_amount != null ? formatInr(order.total_amount) : 'N/A';
  const expected = issue.expected_value || {};
  const actual = issue.actual_value || {};

  switch (issue.issue_type) {
    case 'missing_payment_txn':
      return {
        summary: `${orderLabel} is marked paid but has no payment transaction record.`,
        detail: `Order total: ${orderAmount}. Payment method: ${order?.payment_method || 'N/A'}.`,
        suggestedAction: 'Run reconciliation to backfill the transaction, or confirm payment through the Razorpay / bank-transfer flow.'
      };
    case 'missing_receipt':
      return {
        summary: `${orderLabel} is marked paid but has no payment receipt.`,
        detail: `Order total: ${orderAmount}.`,
        suggestedAction: 'Run reconciliation to generate the missing receipt and ledger entry.'
      };
    case 'amount_mismatch':
      return {
        summary: `${orderLabel} receipt amount does not match the order total.`,
        detail: `Expected ${formatInr(expected.orderTotal)} but receipt shows ${formatInr(actual.receiptAmount)}.`,
        suggestedAction: 'Verify the paid amount and update the receipt or order total before resolving.'
      };
    case 'ledger_mismatch':
      return {
        summary: `${orderLabel} is missing the accounting ledger entry for its payment receipt.`,
        detail: 'Receipt exists, but no ledger booking was found.',
        suggestedAction: 'Run reconciliation to recreate the ledger entry automatically.'
      };
    case 'missing_invoice':
      return {
        summary: `${orderLabel} is missing its invoice record.`,
        detail: `Order total: ${orderAmount}.`,
        suggestedAction: 'Generate the invoice for this paid order, then resolve the issue.'
      };
    default:
      return {
        summary: `${orderLabel} has an open reconciliation issue (${issue.issue_type}).`,
        detail: '',
        suggestedAction: 'Review the order payment records and resolve when corrected.'
      };
  }
}

function enrichReconciliationIssue(issue, order) {
  const description = describeReconciliationIssue(issue, order);
  return {
    ...issue,
    orderNumber: order?.order_number || null,
    orderAmount: order?.total_amount != null ? toNumber(order.total_amount) : null,
    paymentMethod: order?.payment_method || null,
    paymentStatus: order?.payment_status || null,
    orderDate: order?.created_at || null,
    summary: description.summary,
    detail: description.detail,
    suggestedAction: description.suggestedAction
  };
}

async function fetchPaidOrders({ fromDate, toDate }) {
  let ordersQuery = supabase
    .from('orders')
    .select(`
      id,
      order_number,
      total_amount,
      payment_status,
      payment_method,
      payment_provider,
      created_at,
      service_provider:service_provider_id (name, company),
      supplier:supplier_id (name, company)
    `)
    .eq('payment_status', 'paid');
  if (fromDate) ordersQuery = ordersQuery.gte('created_at', fromDate);
  if (toDate) ordersQuery = ordersQuery.lte('created_at', toDate);
  const { data: paidOrders, error } = await ordersQuery.order('created_at', { ascending: false });
  if (error) throw error;
  return paidOrders || [];
}

async function loadReconciliationArtifacts(orderIds) {
  if (!orderIds.length) {
    return { receiptsByOrder: new Map(), txnsByOrder: new Map(), ledgerByOrder: new Map() };
  }

  const [{ data: receipts }, { data: txns }] = await Promise.all([
    supabase
      .from('payment_receipts')
      .select('id, order_id, amount, receipt_number, paid_at, payment_reference')
      .in('order_id', orderIds),
    supabase
      .from('payment_transactions')
      .select('id, order_id, amount, status, method, provider_payment_id, created_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: false })
  ]);

  const receiptsByOrder = indexByOrderId(receipts || []);
  const receiptIds = (receipts || []).map((row) => row.id).filter(Boolean);
  let ledgerRows = [];
  if (receiptIds.length) {
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('id, amount, metadata, reference_id')
      .eq('reference_type', 'payment_receipt')
      .in('reference_id', receiptIds);
    if (error) throw error;
    ledgerRows = data || [];
  }

  const txnsByOrder = new Map();
  for (const txn of txns || []) {
    if (!txnsByOrder.has(txn.order_id)) txnsByOrder.set(txn.order_id, txn);
  }

  return {
    receiptsByOrder,
    txnsByOrder,
    ledgerByOrder: groupLedgerByOrderId(ledgerRows, receiptsByOrder)
  };
}

export async function buildReconciliationStatement({
  fromDate = null,
  toDate = null,
  filter = 'all',
  backfill = false
}) {
  const paidOrders = await fetchPaidOrders({ fromDate, toDate });
  if (backfill) {
    for (const order of paidOrders) {
      await backfillPaidOrderRecords(order);
    }
  }
  const orderIds = paidOrders.map((order) => order.id);
  const { receiptsByOrder, txnsByOrder, ledgerByOrder } = await loadReconciliationArtifacts(orderIds);

  let lines = paidOrders.map((order) =>
    buildLineFromOrder(
      order,
      receiptsByOrder.get(order.id) || null,
      txnsByOrder.get(order.id) || null,
      ledgerByOrder.get(order.id) || []
    )
  );

  if (filter === 'matched') lines = lines.filter((line) => line.status === 'matched');
  if (filter === 'mismatch') lines = lines.filter((line) => line.status === 'mismatch');

  const summary = summarizeLines(lines);

  return {
    generatedAt: new Date().toISOString(),
    fromDate,
    toDate,
    filter,
    ...summary,
    lines
  };
}

export async function buildSettlementSummary({ fromDate = null, toDate = null }) {
  let query = supabase
    .from('payment_transactions')
    .select('id, order_id, method, status, amount, created_at')
    .eq('transaction_type', 'payment')
    .in('status', ['captured', 'settled']);
  if (fromDate) query = query.gte('created_at', fromDate);
  if (toDate) query = query.lte('created_at', toDate);
  const { data: rows, error } = await query;
  if (error) throw error;

  const byMethod = {};
  let totalCaptured = 0;
  for (const row of rows || []) {
    const amount = toNumber(row.amount);
    totalCaptured += amount;
    const key = row.method || 'unknown';
    byMethod[key] = (byMethod[key] || 0) + amount;
  }

  return {
    fromDate,
    toDate,
    transactionCount: (rows || []).length,
    totalCaptured: Number(totalCaptured.toFixed(2)),
    byMethod
  };
}

async function loadOpenIssueKeys(orderIds) {
  if (!orderIds.length) return new Set();
  const { data, error } = await supabase
    .from('reconciliation_issues')
    .select('order_id, issue_type')
    .eq('status', 'open')
    .in('order_id', orderIds);
  if (error) throw error;
  return new Set((data || []).map((row) => issueKey(row.order_id, row.issue_type)));
}

async function autoResolveFixedIssues({ orderIds, stillBrokenOrderIds, actorUserId }) {
  const brokenSet = new Set(stillBrokenOrderIds);
  const fixedOrderIds = orderIds.filter((id) => !brokenSet.has(id));
  if (!fixedOrderIds.length) return 0;

  const { data, error } = await supabase
    .from('reconciliation_issues')
    .update({
      status: 'resolved',
      notes: 'Auto-resolved after reconciliation run',
      resolved_by: actorUserId || null,
      resolved_at: new Date().toISOString()
    })
    .eq('status', 'open')
    .in('order_id', fixedOrderIds)
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

export async function runPaymentReconciliation({ fromDate = null, toDate = null, actorUserId = null }) {
  const run = await createRun({ runType: 'payment_receipt', fromDate, toDate, actorUserId });
  try {
    const statement = await buildReconciliationStatement({ fromDate, toDate, filter: 'all', backfill: true });
    const orderIds = statement.lines.map((line) => line.orderId);
    const stillBrokenOrderIds = [...new Set(statement.issues.map((i) => i.order_id))];
    const openIssueKeys = await loadOpenIssueKeys(orderIds);

    const newIssues = statement.issues.filter(
      (issue) => !openIssueKeys.has(issueKey(issue.order_id, issue.issue_type))
    );

    if (newIssues.length) {
      const { error: insertError } = await supabase.from('reconciliation_issues').insert(
        newIssues.map((issue) => ({
          reconciliation_run_id: run.id,
          ...issue
        }))
      );
      if (insertError) throw insertError;
    }

    const autoResolved = await autoResolveFixedIssues({
      orderIds,
      stillBrokenOrderIds,
      actorUserId
    });

    const summary = {
      successRatePct: statement.successRatePct,
      matched: statement.matched,
      issueCount: statement.issueCount,
      newIssues: newIssues.length,
      autoResolved
    };

    await supabase
      .from('reconciliation_runs')
      .update({
        status: 'completed',
        total_checked: statement.checked,
        mismatched_count: statement.mismatches,
        summary
      })
      .eq('id', run.id);

    return {
      runId: run.id,
      checked: statement.checked,
      matched: statement.matched,
      mismatches: statement.mismatches,
      issueCount: statement.issueCount,
      newIssues: newIssues.length,
      autoResolved,
      successRatePct: statement.successRatePct,
      totalOrderAmount: statement.totalOrderAmount,
      totalReceiptAmount: statement.totalReceiptAmount,
      totalTransactionAmount: statement.totalTransactionAmount,
      fromDate,
      toDate,
      lines: statement.lines
    };
  } catch (error) {
    await supabase
      .from('reconciliation_runs')
      .update({ status: 'failed', summary: { error: error.message || 'Reconciliation failed' } })
      .eq('id', run.id);
    throw error;
  }
}

export async function listReconciliationIssues({ status = 'open', limit = 200 } = {}) {
  let query = supabase
    .from('reconciliation_issues')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Number(limit) || 200);
  if (status && status !== 'all') query = query.eq('status', status);
  const { data: issues, error } = await query;
  if (error) throw error;

  const orderIds = [...new Set((issues || []).map((issue) => issue.order_id).filter(Boolean))];
  let orderMap = new Map();
  if (orderIds.length) {
    const { data: orders, error: ordersError } = await supabase
      .from('orders')
      .select('id, order_number, total_amount, payment_status, payment_method, created_at')
      .in('id', orderIds);
    if (ordersError) throw ordersError;
    orderMap = new Map((orders || []).map((order) => [order.id, order]));
  }

  return (issues || []).map((issue) => enrichReconciliationIssue(issue, orderMap.get(issue.order_id) || null));
}

export async function listReconciliationRuns({ limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('reconciliation_runs')
    .select('id, run_type, from_date, to_date, total_checked, mismatched_count, status, summary, created_at')
    .order('created_at', { ascending: false })
    .limit(Number(limit) || 20);
  if (error) throw error;
  return data || [];
}

export default {
  runPaymentReconciliation,
  buildReconciliationStatement,
  buildSettlementSummary,
  listReconciliationIssues,
  listReconciliationRuns
};
