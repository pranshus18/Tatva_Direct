import express from 'express';
import { supabase } from '../../config/supabase.js';
import { createReceiptAndDeliver } from '../../services/paymentReceiptService.js';
import { createInvoiceForOrder } from '../../services/invoiceService.js';
import { generateAndUploadInvoicePdf, saveInvoicePdfUrlToInvoice } from '../../services/invoicePdfService.js';
import { upsertPaymentTransaction } from '../../services/paymentTransactionService.js';
import { normalizePaymentMethodForOrder } from '../../utils/paymentNormalize.js';
import { verifyRazorpayWebhookSignature } from '../../services/razorpayService.js';

const paymentsWebhookRouter = express.Router();

paymentsWebhookRouter.post('/razorpay', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body || {});
    const isValid = verifyRazorpayWebhookSignature({ rawBody, signature });
    const payload = req.body instanceof Buffer ? JSON.parse(rawBody || '{}') : req.body || {};
    const eventType = payload?.event || 'unknown';
    const providerEventId = payload?.payload?.payment?.entity?.id || payload?.payload?.order?.entity?.id || null;

    const { data: loggedEvent, error: logError } = await supabase
      .from('payment_webhook_events')
      .insert({
        provider: 'razorpay',
        event_type: eventType,
        provider_event_id: providerEventId,
        signature: signature || null,
        payload,
        processing_status: isValid ? 'received' : 'failed',
        processing_error: isValid ? null : 'Invalid webhook signature'
      })
      .select('*')
      .maybeSingle();

    if (logError && logError.code === '23505') {
      return res.json({ status: 'ok', deduplicated: true });
    }
    if (logError) throw logError;

    if (!isValid) {
      return res.status(400).json({ status: 'error', message: 'Invalid webhook signature' });
    }

    const paymentEntity = payload?.payload?.payment?.entity || null;
    if (paymentEntity?.order_id && paymentEntity?.id) {
      const { data: order } = await supabase
        .from('orders')
        .select('*')
        .eq('payment_provider_order_id', paymentEntity.order_id)
        .maybeSingle();
      if (order) {
        await upsertPaymentTransaction({
          order_id: order.id,
          service_provider_id: order.service_provider_id,
          supplier_id: order.supplier_id,
          provider: 'razorpay',
          method: paymentEntity.method || 'upi',
          transaction_type: 'payment',
          amount: (Number(paymentEntity.amount || 0) / 100).toFixed(2),
          provider_order_id: paymentEntity.order_id,
          provider_payment_id: paymentEntity.id,
          status: paymentEntity.status === 'captured' ? 'captured' : 'authorized',
          metadata: { webhook: true, payload: paymentEntity }
        });

        if (paymentEntity.status === 'captured') {
          const wasAlreadyPaid = String(order.payment_status || '').toLowerCase() === 'paid';
          const { data: updatedOrder } = await supabase
            .from('orders')
            .update({
              payment_status: 'paid',
              payment_method: normalizePaymentMethodForOrder(paymentEntity.method || 'online'),
              payment_provider: 'razorpay',
              payment_provider_payment_id: paymentEntity.id,
              payment_verified_at: new Date().toISOString()
            })
            .eq('id', order.id)
            .select('*')
            .single();
          if (!wasAlreadyPaid && updatedOrder) {
            await createReceiptAndDeliver({
              order: updatedOrder,
              paymentMethod: normalizePaymentMethodForOrder(paymentEntity.method || 'online'),
              paymentReference: paymentEntity.id,
              actorUserId: null
            });
            try {
              const { invoice } = await createInvoiceForOrder(updatedOrder);
              const { pdfUrl, pdfPath } = await generateAndUploadInvoicePdf({ order: updatedOrder, invoice });
              if (pdfUrl) {
                await saveInvoicePdfUrlToInvoice({ orderId: updatedOrder.id, pdfUrl, pdfPath });
              }
            } catch (invoicePdfErr) {
              console.error('[Payments] Invoice PDF after Razorpay webhook:', invoicePdfErr);
            }
          }
        }
      }
    }

    if (loggedEvent?.id) {
      await supabase
        .from('payment_webhook_events')
        .update({ processing_status: 'processed', processed_at: new Date().toISOString() })
        .eq('id', loggedEvent.id);
    }

    return res.json({ status: 'ok' });
  } catch (e) {
    console.error('[Payments] Razorpay webhook processing failed:', e);
    return res.status(500).json({ status: 'error', message: 'Webhook processing failed' });
  }
});

export { paymentsWebhookRouter };
