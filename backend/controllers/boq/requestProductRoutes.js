/** BOQ routes: requestProduct */
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { boqRequestProductSchema } from '../../contracts/boqContracts.js';
import { supabase } from '../../config/supabase.js';
import { findUserBasicById } from '../../repositories/usersRepository.js';
import {
  notifyTerminalSuppliersAboutProductRequest,
  resolveBrandAndTerminalRoleForProductRequest
} from '../../services/boqProductRequestNotificationService.js';
import { SUPPLY_CHAIN_ROLE_LABELS } from '../../services/supplyChainSharedService.js';

function buildSuccessMessage({ productName, suppliersNotified, terminalRole, notifyScope }) {
  if (notifyScope === 'all_suppliers') {
    return `Request sent. ${suppliersNotified} supplier${suppliersNotified === 1 ? '' : 's'} on the platform ${suppliersNotified === 1 ? 'was' : 'were'} notified that a customer is looking for "${productName}". They can add the product from their supplier portal if they stock it.`;
  }

  const roleLabel = SUPPLY_CHAIN_ROLE_LABELS[terminalRole] || terminalRole;
  return `Request sent. ${suppliersNotified} ${roleLabel} supplier${suppliersNotified === 1 ? '' : 's'} notified that a customer is looking for "${productName}". They can add the product from their supplier portal if they stock it.`;
}

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

    const { data: serviceProvider } = await findUserBasicById(req.userId, supabase);
    const productName = name.trim();

    const resolved = await resolveBrandAndTerminalRoleForProductRequest(supabase, productName, brand);
    const resolvedBrand = resolved.brandName || brand || productName;
    const terminalRole = resolved.terminalRole;

    const supplierResult = await notifyTerminalSuppliersAboutProductRequest({
      db: supabase,
      request: {
        name: productName,
        category: String(category).trim().toLowerCase(),
        unit: String(unit).trim().toLowerCase(),
        description: description || '',
        boqId: boqId || null,
        requestedByServiceProviderId: req.userId
      },
      brandName: resolvedBrand,
      terminalRole,
      serviceProvider
    });

    const { notifiedCount: suppliersNotified, notifyScope } = supplierResult;

    console.log(
      `[BOQ Product Request] Notified ${suppliersNotified} supplier(s) for "${productName}" (brand: ${resolvedBrand || 'n/a'}, scope: ${notifyScope}, role: ${terminalRole || 'none'})`
    );

    if (suppliersNotified === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No suppliers are registered on the platform yet.',
        brand: resolvedBrand,
        terminalRole: terminalRole || null,
        notifyScope
      });
    }

    return res.status(201).json({
      status: 'success',
      message: buildSuccessMessage({
        productName,
        suppliersNotified,
        terminalRole,
        notifyScope
      }),
      suppliersNotified,
      brand: resolvedBrand,
      terminalRole: terminalRole || null,
      notifyScope
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[BOQ Product Request] Unexpected error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to notify suppliers about this product request'
    });
  }
});
}
