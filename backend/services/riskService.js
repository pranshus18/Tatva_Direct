import { supabase } from '../config/supabase.js';

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function evaluatePaymentRisk({ order, actorUserId }) {
  if (!order?.id) return { score: 0, flags: [] };

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [txnRes, orderRes, supplierRes] = await Promise.all([
    supabase
      .from('payment_transactions')
      .select('id, amount, created_at')
      .eq('service_provider_id', order.service_provider_id)
      .gte('created_at', oneHourAgo),
    supabase
      .from('orders')
      .select('id, total_amount, created_at')
      .eq('service_provider_id', order.service_provider_id)
      .gte('created_at', oneDayAgo),
    supabase
      .from('order_returns')
      .select('id')
      .eq('supplier_id', order.supplier_id)
  ]);

  const hourTxnCount = (txnRes.data || []).length;
  const dailyAmounts = (orderRes.data || []).map((o) => toNumber(o.total_amount));
  const avgDaily = dailyAmounts.length ? dailyAmounts.reduce((a, b) => a + b, 0) / dailyAmounts.length : 0;
  const currentAmount = toNumber(order.total_amount);
  const returnSignals = (supplierRes.data || []).length;

  let score = 0;
  const flags = [];

  if (hourTxnCount >= 5) {
    score += 35;
    flags.push('velocity');
  }
  if (avgDaily > 0 && currentAmount > avgDaily * 3) {
    score += 30;
    flags.push('amount_spike');
  }
  if (returnSignals >= 10) {
    score += 20;
    flags.push('supplier_risk');
  }
  if (!avgDaily && currentAmount > 100000) {
    score += 25;
    flags.push('buyer_risk');
  }

  const normalizedScore = Math.min(100, score);
  if (normalizedScore > 0) {
    await supabase.from('risk_signals').insert({
      order_id: order.id,
      actor_user_id: actorUserId || null,
      signal_type: flags[0] || 'suspicious_pattern',
      risk_score: normalizedScore,
      status: normalizedScore >= 70 ? 'blocked' : 'open',
      metadata: { flags, hourTxnCount, avgDaily, currentAmount, returnSignals }
    });
  }

  return { score: normalizedScore, flags };
}

export default { evaluatePaymentRisk };
