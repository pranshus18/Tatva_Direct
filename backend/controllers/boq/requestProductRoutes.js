/** BOQ routes: requestProduct */
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { boqRequestProductSchema } from '../../contracts/boqContracts.js';
import { supabase } from '../../config/supabase.js';
import { findUserBasicById } from '../../repositories/usersRepository.js';
import {
  notifyAdminsAboutProductRequest,
  notifyTerminalSuppliersAboutProductRequest,
  resolveBrandAndTerminalRoleForProductRequest
} from '../../services/boqProductRequestNotificationService.js';

export function registerBoqRequestProductRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    supabase
  } = ctx;

router.post('/request-product', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(boqRequestProductSchema, req.body || {});
    const { name, category, unit, description, boqId, brand } = payload;

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

    const { data: serviceProvider } = await findUserBasicById(req.userId, supabase);

    let adminsNotified = 0;
    let suppliersNotified = 0;
    let resolvedBrand = null;
    let terminalRole = null;

    try {
      adminsNotified = await notifyAdminsAboutProductRequest({
        db: supabase,
        product: newProduct,
        serviceProvider,
        boqId: boqId || null,
        adminEmail: process.env.ADMIN_EMAIL || 'admin@tatvadirect.com'
      });
    } catch (notifError) {
      console.error('[BOQ Product Request] Failed to create admin notifications:', notifError);
    }

    try {
      const resolved = await resolveBrandAndTerminalRoleForProductRequest(supabase, name, brand);
      resolvedBrand = resolved.brandName;
      terminalRole = resolved.terminalRole;
      const supplierResult = await notifyTerminalSuppliersAboutProductRequest({
        db: supabase,
        product: newProduct,
        brandName: resolvedBrand,
        terminalRole,
        serviceProvider
      });
      suppliersNotified = supplierResult.notifiedCount;
      console.log(
        `[BOQ Product Request] Notified ${suppliersNotified} terminal supplier(s) for "${newProduct.name}" (brand: ${resolvedBrand || 'n/a'}, role: ${terminalRole || 'none configured'})`
      );
    } catch (supplierNotifError) {
      console.error('[BOQ Product Request] Failed to notify terminal suppliers:', supplierNotifError);
    }

    return res.status(201).json({
      status: 'success',
      message:
        suppliersNotified > 0
          ? `Product request submitted. ${suppliersNotified} terminal supplier${suppliersNotified === 1 ? '' : 's'} notified to add this product. Admin review is pending.`
          : 'Product request submitted and is pending admin approval.',
      product: newProduct,
      suppliersNotified,
      adminsNotified,
      brand: resolvedBrand,
      terminalRole
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
