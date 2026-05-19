/** Dashboard routes: payment */
import {
  createInvoiceForOrder,
  createReceiptAndDeliver,
  findUserBasicById,
  generateAndUploadInvoicePdf,
  getContractErrorMessage,
  insertNotification,
  parseWithSchema,
  restockInventoryForCancelledOrder,
  saveInvoicePdfUrlToInvoice,
  sendEmail,
  updateOrderPaymentSchema
} from './dashboardImports.js';
export * from './shared/dashboardHelpers.js';

export function registerDashboardPaymentRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase
  } = ctx;

router.patch('/service-provider/orders/:id/payment', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const payload = parseWithSchema(updateOrderPaymentSchema, req.body || {});
    const { paymentStatus, paymentMethod, paymentReference, paidAt } = payload;
    const decodedId = decodeURIComponent(id);
    
    console.log(`Updating payment status for order: ${decodedId}, Status: ${paymentStatus}, User: ${req.userId}`);
    
    // Try to find by orderNumber first
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', decodedId)
      .eq('service_provider_id', req.userId)
      .single();
    
    // If not found by orderNumber, try id
    if (orderError || !order) {
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', decodedId)
        .eq('service_provider_id', req.userId)
        .single();
      
      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
      }
    }
    
    if (orderError || !order) {
      console.log(`Order not found for payment update: ${decodedId} for user ${req.userId}`);
      return res.status(404).json({ 
        status: 'error',
        message: 'Order not found or you do not have permission to update this order' 
      });
    }
    
    // Get current status history
    const statusHistory = order.status_history || [];
    
    // Add to status history
    statusHistory.push({
      status: order.status,
      updatedBy: req.userId,
      notes: `Payment status updated to ${paymentStatus}`,
      timestamp: new Date().toISOString()
    });
    
    // Update payment status
    const updateData = {
      payment_status: paymentStatus,
      status_history: statusHistory
    };
    
    if (paymentMethod) {
      updateData.payment_method = paymentMethod;
    }
    
    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', order.id)
      .select(`
        *,
        order_items (
          *,
          product:products (*)
        ),
        supplier:users!orders_supplier_id_fkey (id, name, company, email, phone, address),
        boq:boqs (id, name)
      `)
      .single();
    
    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to update payment status'
      });
    }
    
    // If payment status is updated to "paid", create a notification for the supplier
    if (paymentStatus === 'paid' && order.supplier_id) {
      try {
        await insertNotification({
          user_id: order.supplier_id,
          type: 'payment_received',
          title: 'Payment Received',
          message: `Payment of ₹${parseFloat(order.total_amount || 0).toLocaleString('en-IN')} has been received for Order ${order.order_number}`,
          related_order_id: order.id,
          is_read: false
        }, supabase);
        console.log(`Notification created for supplier ${order.supplier_id} about payment for order ${order.order_number}`);
      } catch (notifError) {
        console.error('Error creating payment notification:', notifError);
      }
    }

    // If paid: create an auditable receipt and deliver it to BOTH parties (notifications + optional email)
    let receiptDelivery = null;
    let invoiceDelivery = null;
    if (paymentStatus === 'paid') {
      try {
        receiptDelivery = await createReceiptAndDeliver({
          order: updatedOrder,
          paymentMethod: paymentMethod || updatedOrder.payment_method,
          paymentReference,
          paidAt,
          actorUserId: req.userId
        });
      } catch (receiptErr) {
        console.error('[Payment] Receipt generation/delivery failed:', receiptErr);
        // Do not fail the payment status update if receipt delivery fails.
      }

      // Generate a tracking-aware Invoice PDF and provide it to both parties
      try {
        const { invoice } = await createInvoiceForOrder(updatedOrder);
        const { pdfUrl, pdfPath } = await generateAndUploadInvoicePdf({
          order: updatedOrder,
          invoice
        });

        invoiceDelivery = {
          invoiceNumber: invoice?.invoice_number || null,
          pdfUrl: pdfUrl || null
        };

        if (pdfUrl) {
          await saveInvoicePdfUrlToInvoice({
            orderId: updatedOrder.id,
            pdfUrl,
            pdfPath
          });

          // Best-effort email link delivery (if email exists/configured).
          const [{ data: supplier }, { data: serviceProvider }] = await Promise.all([
            updatedOrder.supplier_id
              ? findUserBasicById(updatedOrder.supplier_id, supabase)
              : Promise.resolve({ data: null }),
            updatedOrder.service_provider_id
              ? findUserBasicById(updatedOrder.service_provider_id, supabase)
              : Promise.resolve({ data: null })
          ]);

          const subject = `Invoice ${invoice?.invoice_number || ''} (Order ${updatedOrder.order_number})`.trim();
          const html = `
          <div style="font-family: Arial, sans-serif; line-height: 1.4;">
            <h2 style="margin:0 0 10px;">Invoice Ready</h2>
            <p style="margin:0 0 12px;">
              Your invoice <strong>${invoice?.invoice_number || ''}</strong> for
              <strong>Order ${updatedOrder.order_number}</strong> is generated successfully.
            </p>
            <p style="margin:0;">
              Download PDF:
              <a href="${pdfUrl}" target="_blank" rel="noopener noreferrer">${pdfUrl}</a>
            </p>
          </div>
        `.trim();

          const emailResults = await Promise.all([
            supplier?.email
              ? sendEmail({
                  to: supplier.email,
                  subject,
                  text: `Invoice ${invoice?.invoice_number} generated. Download: ${pdfUrl}`,
                  html
                })
              : Promise.resolve(null),
            serviceProvider?.email
              ? sendEmail({
                  to: serviceProvider.email,
                  subject,
                  text: `Invoice ${invoice?.invoice_number} generated. Download: ${pdfUrl}`,
                  html
                })
              : Promise.resolve(null)
          ]);

          console.log('[Payment] Invoice PDF generated and email(s) attempted:', emailResults);
        }
      } catch (invoiceErr) {
        console.error('[Payment] Invoice PDF generation/delivery failed:', invoiceErr);
      }
    }
    
    console.log(`Payment status updated successfully: ${updatedOrder.order_number} to ${paymentStatus}`);
    
    res.json({ 
      status: 'success',
      message: 'Payment status updated successfully',
      order: updatedOrder,
      receipt: receiptDelivery?.receipt || null,
      invoice: invoiceDelivery || null
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update payment status error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message 
    });
  }
});
}
