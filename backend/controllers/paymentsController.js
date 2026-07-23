import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { requireFinanceRole } from '../middleware/financeMiddleware.js';
import { supabase } from '../config/supabase.js';
import { createReceiptAndDeliver } from '../services/paymentReceiptService.js';
import { createInvoiceForOrder } from '../services/invoiceService.js';
import { generateAndUploadInvoicePdf, saveInvoicePdfUrlToInvoice } from '../services/invoicePdfService.js';
import { writeAuditLog } from '../services/auditService.js';
import { evaluatePaymentRisk } from '../services/riskService.js';
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpayPublicConfig,
  isRazorpayConfigured,
  verifyRazorpayPaymentSignature
} from '../services/razorpayService.js';
import {
  bankTransferMarkSchema,
  bankTransferRequestSchema,
  creditLineApproveSchema,
  paymentConfirmSchema,
  paymentCreateSchema,
  riskSignalReviewSchema
} from '../contracts/paymentContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import { upsertPaymentTransaction } from '../services/paymentTransactionService.js';
import { applyPlatformFeeToPaidOrder } from '../services/platformFeeService.js';
import { normalizePaymentMethodForOrder, httpStatusForUpstreamError } from '../utils/paymentNormalize.js';
import { parseBooleanEnv } from '../utils/featureFlags.js';

const router = express.Router();
const directOrderPaymentDisabled = () => parseBooleanEnv('DIRECT_ORDER_PAYMENT_DISABLED', false);

router.post('/orders/:id/razorpay/create', authenticateToken, async (req, res) => {
  try {
    if (directOrderPaymentDisabled()) {
      return res.status(410).json({
        status: 'error',
        code: 'DIRECT_PAYMENT_DISABLED',
        message: 'Direct order payment is disabled. Use wallet top-up and wallet checkout.'
      });
    }
    if (!isRazorpayConfigured()) {
      return res.status(503).json({
        status: 'error',
        code: 'RAZORPAY_NOT_CONFIGURED',
        message: 'Online payment is temporarily unavailable. Please add Razorpay keys in server env.'
      });
    }

    const orderId = req.params.id;
    const payload = parseWithSchema(paymentCreateSchema, req.body || {});
    const idempotencyKey = payload.idempotencyKey || null;
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    if (error || !order) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    if (req.user?.user_type !== 'admin' && order.service_provider_id !== req.userId) {
      return res.status(403).json({ status: 'error', message: 'Not authorized for this order' });
    }

    const risk = await evaluatePaymentRisk({ order, actorUserId: req.userId });
    if (risk.score >= 80) {
      await writeAuditLog({
        actorUserId: req.userId,
        actorRole: req.user?.user_type,
        action: 'payment_intent_blocked_high_risk',
        resourceType: 'order',
        resourceId: order.id,
        ipAddress: req.ip,
        requestId: req.requestId,
        metadata: { risk }
      });
      return res.status(400).json({ status: 'error', message: 'Payment blocked due to high risk', risk });
    }

    if (String(order.payment_status || '').toLowerCase() === 'paid') {
      return res.status(400).json({ status: 'error', message: 'Order is already marked as paid' });
    }

    const rpOrder = await createRazorpayOrder({
      amountInRupees: order.total_amount,
      receipt: `ORD-${order.order_number}`,
      notes: { orderId: order.id, orderNumber: order.order_number }
    });

    await supabase
      .from('orders')
      .update({
        payment_provider: 'razorpay',
        payment_provider_order_id: rpOrder.id
      })
      .eq('id', order.id);

    const transaction = await upsertPaymentTransaction({
      order_id: order.id,
      service_provider_id: order.service_provider_id,
      supplier_id: order.supplier_id,
      provider: 'razorpay',
      method: 'upi',
      transaction_type: 'payment',
      amount: order.total_amount,
      provider_order_id: rpOrder.id,
      status: 'created',
      idempotency_key: idempotencyKey,
      metadata: { risk }
    });

    await writeAuditLog({
      actorUserId: req.userId,
      actorRole: req.user?.user_type,
      action: 'payment_intent_created',
      resourceType: 'payment_transaction',
      resourceId: transaction.id,
      ipAddress: req.ip,
      requestId: req.requestId,
      metadata: { orderId: order.id, providerOrderId: rpOrder.id }
    });

    return res.json({
      status: 'success',
      paymentIntent: {
        provider: 'razorpay',
        orderId: rpOrder.id,
        amount: rpOrder.amount,
        currency: rpOrder.currency
      },
      risk
    });
  } catch (e) {
    console.error('[Payments] create razorpay order error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    const status = httpStatusForUpstreamError(e);
    const message =
      status === 504
        ? 'Payment provider timed out. Please try again.'
        : e.message || 'Failed to create payment intent';
    return res.status(status).json({
      status: 'error',
      message,
      ...(req.requestId ? { requestId: req.requestId } : {})
    });
  }
});

router.post('/orders/:id/razorpay/confirm', authenticateToken, async (req, res) => {
  try {
    if (directOrderPaymentDisabled()) {
      return res.status(410).json({
        status: 'error',
        code: 'DIRECT_PAYMENT_DISABLED',
        message: 'Direct order payment is disabled. Use wallet top-up and wallet checkout.'
      });
    }
    if (!isRazorpayConfigured()) {
      return res.status(503).json({
        status: 'error',
        code: 'RAZORPAY_NOT_CONFIGURED',
        message: 'Online payment verification is unavailable. Please configure Razorpay keys.'
      });
    }

    const orderId = req.params.id;
    const payload = parseWithSchema(paymentConfirmSchema, req.body || {});
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, method = 'upi' } = payload;

    const isValid = verifyRazorpayPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature
    });
    if (!isValid) {
      return res.status(400).json({ status: 'error', message: 'Invalid payment signature' });
    }

    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();
    if (error || !order) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }
    if (req.user?.user_type !== 'admin' && order.service_provider_id !== req.userId) {
      return res.status(403).json({ status: 'error', message: 'Not authorized for this order' });
    }
    if (!order.payment_provider_order_id || order.payment_provider_order_id !== razorpayOrderId) {
      return res.status(400).json({ status: 'error', message: 'Razorpay order mismatch for this order' });
    }
    if (String(order.payment_status || '').toLowerCase() === 'paid') {
      const { data: existingTxn } = await supabase
        .from('payment_transactions')
        .select('*')
        .eq('order_id', order.id)
        .eq('provider', 'razorpay')
        .eq('provider_payment_id', razorpayPaymentId)
        .maybeSingle();
      return res.json({
        status: 'success',
        order,
        paymentTransaction: existingTxn || null,
        message: 'Payment already confirmed'
      });
    }

    const payment = await fetchRazorpayPayment(razorpayPaymentId);
    if (!payment) {
      return res.status(400).json({ status: 'error', message: 'Unable to fetch payment from provider' });
    }
    if (payment.order_id !== razorpayOrderId) {
      return res.status(400).json({ status: 'error', message: 'Payment does not belong to provided Razorpay order' });
    }
    const expectedAmountPaise = Math.round(Number(order.total_amount || 0) * 100);
    if (Number(payment.amount || 0) !== expectedAmountPaise) {
      return res.status(400).json({ status: 'error', message: 'Payment amount mismatch' });
    }
    if (payment.status !== 'captured') {
      await upsertPaymentTransaction({
        order_id: order.id,
        service_provider_id: order.service_provider_id,
        supplier_id: order.supplier_id,
        provider: 'razorpay',
        method: normalizePaymentMethodForOrder(payment.method || method),
        transaction_type: 'payment',
        amount: order.total_amount,
        provider_order_id: razorpayOrderId,
        provider_payment_id: razorpayPaymentId,
        provider_signature: razorpaySignature,
        status: payment.status === 'authorized' ? 'authorized' : 'pending',
        metadata: { providerPayload: payment }
      });
      return res.status(409).json({
        status: 'error',
        message: `Payment is not captured yet (provider status: ${payment.status || 'unknown'})`
      });
    }

    const txn = await upsertPaymentTransaction({
      order_id: order.id,
      service_provider_id: order.service_provider_id,
      supplier_id: order.supplier_id,
      provider: 'razorpay',
      method: normalizePaymentMethodForOrder(payment.method || method),
      transaction_type: 'payment',
      amount: order.total_amount,
      provider_order_id: razorpayOrderId,
      provider_payment_id: razorpayPaymentId,
      provider_signature: razorpaySignature,
      status: 'captured',
      metadata: { providerPayload: payment }
    });

    const { data: updatedOrder } = await supabase
      .from('orders')
      .update({
        payment_status: 'paid',
        payment_method: normalizePaymentMethodForOrder(payment.method || method),
        payment_provider: 'razorpay',
        payment_provider_order_id: razorpayOrderId,
        payment_provider_payment_id: razorpayPaymentId,
        payment_verified_at: new Date().toISOString()
      })
      .eq('id', order.id)
      .select('*')
      .single();
    const feeApplied = await applyPlatformFeeToPaidOrder({ order: updatedOrder });
    const paidOrder = feeApplied.order;

    const receiptDelivery = await createReceiptAndDeliver({
      order: paidOrder,
      paymentMethod: method,
      paymentReference: razorpayPaymentId,
      actorUserId: req.userId
    });
    let invoiceSummary = null;
    try {
      const { invoice } = await createInvoiceForOrder(paidOrder);
      const { pdfUrl, pdfPath } = await generateAndUploadInvoicePdf({ order: paidOrder, invoice });
      let invoicePdfUrl = pdfUrl || null;
      if (pdfUrl) {
        const updatedInv = await saveInvoicePdfUrlToInvoice({ orderId: paidOrder.id, pdfUrl, pdfPath });
        if (updatedInv?.metadata?.pdfUrl) invoicePdfUrl = updatedInv.metadata.pdfUrl;
      }
      invoiceSummary = {
        invoiceNumber: invoice?.invoice_number || null,
        invoicePdfUrl
      };
    } catch (invoicePdfErr) {
      console.error('[Payments] Invoice PDF after Razorpay confirm:', invoicePdfErr);
    }

    await writeAuditLog({
      actorUserId: req.userId,
      actorRole: req.user?.user_type,
      action: 'payment_confirmed',
      resourceType: 'order',
      resourceId: paidOrder.id,
      ipAddress: req.ip,
      requestId: req.requestId,
      metadata: {
        provider: 'razorpay',
        providerOrderId: razorpayOrderId,
        providerPaymentId: razorpayPaymentId,
        paymentTransactionId: txn.id
      }
    });

    return res.json({
      status: 'success',
      order: paidOrder,
      paymentTransaction: txn,
      receipt: receiptDelivery?.receipt || null,
      invoice: invoiceSummary
    });
  } catch (e) {
    console.error('[Payments] confirm payment error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    if (
      e?.code === 'PLATFORM_FEE_RULE_MISSING' ||
      e?.code === 'PLATFORM_FEE_ROLE_MISSING' ||
      e?.code === 'PLATFORM_FEE_BRAND_MISSING' ||
      e?.code === 'PLATFORM_FEE_ORDER_ITEMS_MISSING'
    ) {
      return res.status(400).json({
        status: 'error',
        code: e.code,
        message: e.message,
        ...(req.requestId ? { requestId: req.requestId } : {})
      });
    }
    const status = httpStatusForUpstreamError(e);
    const message =
      status === 504
        ? 'Payment provider timed out. Please try again.'
        : e.message || 'Failed to confirm payment';
    return res.status(status).json({
      status: 'error',
      message,
      ...(req.requestId ? { requestId: req.requestId } : {})
    });
  }
});

router.get('/razorpay/config', authenticateToken, async (_req, res) => {
  try {
    const config = getRazorpayPublicConfig();
    return res.json({
      status: 'success',
      razorpay: {
        isConfigured: config.isConfigured,
        keyId: config.keyId
      }
    });
  } catch (e) {
    console.error('[Payments] razorpay config fetch error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch Razorpay config' });
  }
});

router.post('/orders/:id/bank-transfer/mark', authenticateToken, requireFinanceRole, async (req, res) => {
  try {
    const orderId = req.params.id;
    const payload = parseWithSchema(bankTransferMarkSchema, req.body || {});
    const { bankReference, paidAt, amount } = payload;
    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (!order) return res.status(404).json({ status: 'error', message: 'Order not found' });

    const tx = await upsertPaymentTransaction({
      order_id: order.id,
      service_provider_id: order.service_provider_id,
      supplier_id: order.supplier_id,
      provider: 'manual',
      method: 'bank_transfer',
      transaction_type: 'payment',
      amount: amount || order.total_amount,
      provider_payment_id: bankReference,
      status: 'captured',
      metadata: { manualReviewBy: req.userId, paidAt: paidAt || new Date().toISOString() }
    });

    const { data: updatedOrder } = await supabase
      .from('orders')
      .update({
        payment_status: 'paid',
        payment_method: 'bank_transfer',
        payment_provider: 'manual',
        payment_provider_payment_id: bankReference,
        payment_verified_at: new Date().toISOString()
      })
      .eq('id', order.id)
      .select('*')
      .single();
    const feeApplied = await applyPlatformFeeToPaidOrder({ order: updatedOrder });
    const paidOrder = feeApplied.order;

    await createReceiptAndDeliver({
      order: paidOrder,
      paymentMethod: 'bank_transfer',
      paymentReference: bankReference,
      paidAt,
      actorUserId: req.userId
    });
    let invoiceSummary = null;
    try {
      const { invoice } = await createInvoiceForOrder(paidOrder);
      const { pdfUrl, pdfPath } = await generateAndUploadInvoicePdf({ order: paidOrder, invoice });
      let invoicePdfUrl = pdfUrl || null;
      if (pdfUrl) {
        const updatedInv = await saveInvoicePdfUrlToInvoice({ orderId: paidOrder.id, pdfUrl, pdfPath });
        if (updatedInv?.metadata?.pdfUrl) invoicePdfUrl = updatedInv.metadata.pdfUrl;
      }
      invoiceSummary = {
        invoiceNumber: invoice?.invoice_number || null,
        invoicePdfUrl
      };
    } catch (invoicePdfErr) {
      console.error('[Payments] Invoice PDF after bank transfer:', invoicePdfErr);
    }

    await writeAuditLog({
      actorUserId: req.userId,
      actorRole: req.user?.user_type,
      action: 'bank_transfer_marked_paid',
      resourceType: 'order',
      resourceId: paidOrder.id,
      ipAddress: req.ip,
      requestId: req.requestId,
      metadata: { bankReference, transactionId: tx.id }
    });

    return res.json({
      status: 'success',
      order: paidOrder,
      paymentTransaction: tx,
      invoice: invoiceSummary
    });
  } catch (e) {
    console.error('[Payments] bank transfer mark paid error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    if (
      e?.code === 'PLATFORM_FEE_RULE_MISSING' ||
      e?.code === 'PLATFORM_FEE_ROLE_MISSING' ||
      e?.code === 'PLATFORM_FEE_BRAND_MISSING' ||
      e?.code === 'PLATFORM_FEE_ORDER_ITEMS_MISSING'
    ) {
      return res.status(400).json({ status: 'error', code: e.code, message: e.message });
    }
    return res.status(500).json({ status: 'error', message: e.message || 'Failed to mark bank transfer paid' });
  }
});

router.post('/orders/:id/credit-line/approve', authenticateToken, requireFinanceRole, async (req, res) => {
  try {
    const payload = parseWithSchema(creditLineApproveSchema, req.body || {});
    const { creditLineDays = 30 } = payload;
    const { data: order } = await supabase.from('orders').select('*').eq('id', req.params.id).single();
    if (!order) return res.status(404).json({ status: 'error', message: 'Order not found' });
    const dueAt = new Date(Date.now() + Number(creditLineDays) * 86400000).toISOString();
    const { data: updated } = await supabase
      .from('orders')
      .update({
        payment_status: 'partial',
        payment_method: 'credit',
        credit_line_days: Number(creditLineDays),
        payment_due_at: dueAt
      })
      .eq('id', order.id)
      .select('*')
      .single();

    await writeAuditLog({
      actorUserId: req.userId,
      actorRole: req.user?.user_type,
      action: 'credit_line_approved',
      resourceType: 'order',
      resourceId: order.id,
      ipAddress: req.ip,
      requestId: req.requestId,
      metadata: { creditLineDays: Number(creditLineDays), dueAt }
    });

    return res.json({ status: 'success', order: updated });
  } catch (e) {
    console.error('[Payments] credit line approve error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    return res.status(500).json({ status: 'error', message: e.message || 'Failed to approve credit line' });
  }
});

router.post('/orders/:id/bank-transfer/request', authenticateToken, async (req, res) => {
  try {
    const orderId = req.params.id;
    const payload = parseWithSchema(bankTransferRequestSchema, req.body || {});
    const { amount = null, note = '' } = payload;
    const { data: order, error } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (error || !order) return res.status(404).json({ status: 'error', message: 'Order not found' });
    if (req.user?.user_type !== 'admin' && order.service_provider_id !== req.userId) {
      return res.status(403).json({ status: 'error', message: 'Not authorized for this order' });
    }

    const tx = await upsertPaymentTransaction({
      order_id: order.id,
      service_provider_id: order.service_provider_id,
      supplier_id: order.supplier_id,
      provider: 'manual',
      method: 'bank_transfer',
      transaction_type: 'payment',
      amount: amount || order.total_amount,
      status: 'pending',
      metadata: {
        requestType: 'bank_transfer_request',
        requestedBy: req.userId,
        note
      }
    });

    await writeAuditLog({
      actorUserId: req.userId,
      actorRole: req.user?.user_type,
      action: 'bank_transfer_requested',
      resourceType: 'payment_transaction',
      resourceId: tx.id,
      ipAddress: req.ip,
      requestId: req.requestId,
      metadata: { orderId: order.id, amount: amount || order.total_amount }
    });

    return res.json({ status: 'success', paymentTransaction: tx });
  } catch (e) {
    console.error('[Payments] bank transfer request error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to request bank transfer flow' });
  }
});

router.get('/risk/signals', authenticateToken, requireFinanceRole, async (req, res) => {
  try {
    const { status = 'open', limit = 200 } = req.query;
    let query = supabase
      .from('risk_signals')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit) || 200);
    if (status && status !== 'all') query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ status: 'success', signals: data || [] });
  } catch (e) {
    console.error('[Payments] risk signals fetch failed:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch risk signals' });
  }
});

router.patch('/risk/signals/:id/review', authenticateToken, requireFinanceRole, async (req, res) => {
  try {
    const payload = parseWithSchema(riskSignalReviewSchema, req.body || {});
    const { status = 'reviewed' } = payload;
    if (!['reviewed', 'blocked', 'cleared'].includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Invalid review status' });
    }
    const { data, error } = await supabase
      .from('risk_signals')
      .update({ status, reviewed_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*')
      .single();
    if (error) throw error;

    await writeAuditLog({
      actorUserId: req.userId,
      actorRole: req.user?.user_type,
      action: 'risk_signal_reviewed',
      resourceType: 'risk_signal',
      resourceId: req.params.id,
      ipAddress: req.ip,
      requestId: req.requestId,
      metadata: { status }
    });
    return res.json({ status: 'success', signal: data });
  } catch (e) {
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    console.error('[Payments] risk signal review failed:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to review risk signal' });
  }
});

router.get('/settlement/report', authenticateToken, requireFinanceRole, async (req, res) => {
  try {
    const { fromDate = null, toDate = null } = req.query;
    let query = supabase
      .from('payment_transactions')
      .select('id, order_id, method, status, amount, created_at, supplier_id')
      .eq('transaction_type', 'payment')
      .in('status', ['captured', 'settled']);
    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate) query = query.lte('created_at', toDate);
    const { data: rows, error } = await query;
    if (error) throw error;

    const totalCaptured = (rows || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const byMethod = {};
    (rows || []).forEach((r) => {
      const k = r.method || 'unknown';
      byMethod[k] = (byMethod[k] || 0) + Number(r.amount || 0);
    });
    return res.json({
      status: 'success',
      report: {
        fromDate,
        toDate,
        transactionCount: (rows || []).length,
        totalCaptured,
        byMethod,
        rows: rows || []
      }
    });
  } catch (e) {
    console.error('[Payments] settlement report error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to generate settlement report' });
  }
});

router.get('/audit/logs', authenticateToken, requireFinanceRole, async (req, res) => {
  try {
    const { resourceType = null, limit = 200 } = req.query;
    let query = supabase
      .from('audit_log_entries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Number(limit) || 200);
    if (resourceType) query = query.eq('resource_type', resourceType);
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ status: 'success', logs: data || [] });
  } catch (e) {
    console.error('[Payments] audit logs fetch failed:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch audit logs' });
  }
});

router.get('/metrics', authenticateToken, requireFinanceRole, async (_req, res) => {
  try {
    const [{ data: txns }, { data: webhookEvents }] = await Promise.all([
      supabase.from('payment_transactions').select('status'),
      supabase.from('payment_webhook_events').select('processing_status')
    ]);

    const totalPayments = (txns || []).length;
    const successfulPayments = (txns || []).filter((t) => ['captured', 'settled'].includes(t.status)).length;
    const paymentSuccessRatePct = totalPayments ? Number(((successfulPayments / totalPayments) * 100).toFixed(2)) : 100;
    const webhookFailures = (webhookEvents || []).filter((w) => w.processing_status === 'failed').length;

    return res.json({
      status: 'success',
      metrics: {
        paymentSuccessRatePct,
        webhookFailureCount: webhookFailures
      }
    });
  } catch (e) {
    console.error('[Payments] metrics endpoint error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch payment metrics' });
  }
});

export { router as paymentsRouter };
