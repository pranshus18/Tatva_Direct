/** BOQ routes: requestProduct */
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { boqRequestProductSchema } from '../../contracts/boqContracts.js';
import { supabase } from '../../config/supabase.js';
import { insertNotifications } from '../../repositories/notificationsRepository.js';
import { findAdmins } from '../../repositories/usersRepository.js';

export function registerBoqRequestProductRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    supabase,
    upload
  } = ctx;

router.post('/request-product', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(boqRequestProductSchema, req.body || {});
    const { name, category, unit, description, boqId } = payload;

    // Optionally validate that BOQ (if provided) belongs to this service provider
    if (boqId) {
      const { data: boq, error: boqError } = await supabase
        .from('boqs')
        .select('id, service_provider_id')
        .eq('id', boqId)
        .single();

      if (boqError || !boq || boq.service_provider_id !== req.userId) {
        return res.status(403).json({
          status: 'error',
          message: 'You do not have permission to request products for this BOQ'
        });
      }
    }

    // Create a lightweight catalog product entry that will be reviewed by admin.
    // Price/stock/location are set to safe defaults; suppliers will provide their
    // own values later via supplier portal.
    const { data: newProduct, error: productError } = await supabase
      .from('products')
      .insert({
        name: name.trim(),
        description: description || '',
        category: String(category).trim().toLowerCase(),
        unit: String(unit).trim().toLowerCase(),
        price: 0,
        stock: 0,
        min_order_quantity: 1,
        location: 'Not specified',
        status: 'pending',
        is_active: false,
        requested_by_service_provider_id: req.userId,
        specifications: {},
        tags: ['requested_via_boq']
      })
      .select()
      .single();

    if (productError || !newProduct) {
      console.error('[BOQ Product Request] Product creation error:', productError);
      return res.status(500).json({
        status: 'error',
        message: productError?.message || 'Failed to create requested product'
      });
    }

    console.log(`[BOQ Product Request] New product requested by service provider ${req.userId}:`, {
      id: newProduct.id,
      name: newProduct.name,
      category: newProduct.category
    });

    // Notify all admins that a new product is pending approval
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
    const { data: admins } = await findAdmins(adminEmail, supabase);

    if (admins && admins.length > 0) {
      // Fetch service provider details for richer notification content
      const { data: serviceProvider } = await findUserBasicById(req.userId, supabase);

      const notifications = admins.map((admin) => ({
        user_id: admin.id,
        type: 'product_approval',
        title: `New Product Requested by Service Provider: ${newProduct.name}`,
        message: `${serviceProvider?.name || 'A service provider'} (${serviceProvider?.company || serviceProvider?.email || ''}) has requested a new product "${newProduct.name}" in category "${newProduct.category}". Please review and approve it so suppliers can add their offers.`,
        related_product_id: newProduct.id,
        related_supplier_id: null,
        metadata: {
          productId: newProduct.id,
          productName: newProduct.name,
          productCategory: newProduct.category,
          productUnit: newProduct.unit,
          requestedByServiceProviderId: req.userId,
          requestedByServiceProviderName: serviceProvider?.name,
          requestedByServiceProviderCompany: serviceProvider?.company,
          requestedByServiceProviderEmail: serviceProvider?.email,
          source: 'service_provider_boq_request',
          boqId: boqId || null
        },
        is_read: false
      }));

      try {
        await insertNotifications(notifications, supabase);
        console.log(
          `[BOQ Product Request] Created ${notifications.length} admin notification(s) for requested product ${newProduct.id}`
        );
      } catch (notifError) {
        console.error('[BOQ Product Request] Failed to create admin notifications:', notifError);
      }
    }

    return res.status(201).json({
      status: 'success',
      message: 'Product request submitted and is pending admin approval',
      product: newProduct
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[BOQ Product Request] Unexpected error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to submit product request'
    });
  }
});
}
