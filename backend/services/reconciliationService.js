import { supabase } from '../config/supabase.js';

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

export async function runPaymentReconciliation({ fromDate, toDate, actorUserId }) {
  const run = await createRun({ runType: 'payment_receipt', fromDate, toDate, actorUserId });
  let ordersQuery = supabase
    .from('orders')
    .select('id, order_number, total_amount, payment_status, created_at')
    .eq('payment_status', 'paid');
  if (fromDate) ordersQuery = ordersQuery.gte('created_at', fromDate);
  if (toDate) ordersQuery = ordersQuery.lte('created_at', toDate);
  const { data: paidOrders, error: oErr } = await ordersQuery;
  if (oErr) throw oErr;

  const issues = [];
  for (const order of (paidOrders || [])) {
    const [{ data: receipt }, { data: txn }, { data: ledgerRows }] = await Promise.all([
      supabase.from('payment_receipts').select('id, amount').eq('order_id', order.id).maybeSingle(),
      supabase.from('payment_transactions').select('id, amount, status').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('ledger_entries').select('id, amount').eq('reference_type', 'payment_receipt').eq('metadata->>orderId', order.id)
    ]);

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
    if (ledgerRows && ledgerRows.length === 0) {
      issues.push({
        order_id: order.id,
        issue_type: 'ledger_mismatch',
        severity: 'medium',
        expected_value: { ledgerEntry: 'present' },
        actual_value: { ledgerEntry: 'missing' }
      });
    }
  }

  if (issues.length) {
    await supabase.from('reconciliation_issues').insert(
      issues.map((i) => ({
        reconciliation_run_id: run.id,
        ...i
      }))
    );
  }

  await supabase
    .from('reconciliation_runs')
    .update({
      status: 'completed',
      total_checked: (paidOrders || []).length,
      mismatched_count: issues.length,
      summary: {
        successRatePct: (paidOrders || []).length
          ? Number((((paidOrders.length - issues.length) / paidOrders.length) * 100).toFixed(2))
          : 100
      }
    })
    .eq('id', run.id);

  return {
    runId: run.id,
    checked: (paidOrders || []).length,
    mismatches: issues.length,
    successRatePct: (paidOrders || []).length
      ? Number((((paidOrders.length - issues.length) / paidOrders.length) * 100).toFixed(2))
      : 100
  };
}

export default { runPaymentReconciliation };
