/** BOQ routes: requestProduct */
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { boqRequestProductSchema } from '../../contracts/boqContracts.js';
import { supabase } from '../../config/supabase.js';
import { findUserBasicById } from '../../repositories/usersRepository.js';
import {
  notifyTerminalSuppliersAboutProductRequest,
  resolveBrandAndTerminalRoleForProductRequest
} from '../../services/boqProductRequestNotificationService.js';
import {
  buildBoqProductRequestKey,
  findExistingBoqProductRequest,
  recordBoqProductRequest
} from '../../services/boqProductRequestDedupService.js';
import { notifyServiceProviderProductRequestSubmitted } from '../../services/serviceProviderRequestNotificationService.js';
import { SUPPLY_CHAIN_ROLE_LABELS } from '../../services/supplyChainSharedService.js';

function buildSuccessMessage({ productName, suppliersNotified, terminalRole, notifyScope }) {
  if (notifyScope === 'all_suppliers') {
    return `Request sent. ${suppliersNotified} supplier${suppliersNotified === 1 ? '' : 's'} on the platform ${suppliersNotified === 1 ? 'was' : 'were'} notified that a customer is looking for "${productName}". They can add the product from their supplier portal if they stock it.`;
  }

  const roleLabel = SUPPLY_CHAIN_ROLE_LABELS[terminalRole] || terminalRole;
  return `Request sent. ${suppliersNotified} ${roleLabel} supplier${suppliersNotified === 1 ? '' : 's'} notified that a customer is looking for "${productName}". They can add the product from their supplier portal if they stock it.`;
}

function buildPendingSuccessMessage(productName) {
  return `Request sent. Suppliers are being notified that a customer is looking for "${productName}". They can add the product from their supplier portal if they stock it.`;
}

async function deliverProductRequestNotifications({
  db,
  userId,
  payload,
  productName,
  requestId = null
}) {
  const { category, unit, description, boqId, brand } = payload;
  const { data: serviceProvider } = await findUserBasicById(userId, db);
  const resolved = await resolveBrandAndTerminalRoleForProductRequest(db, productName, brand);
  const resolvedBrand = resolved.brandName || brand || productName;
  const terminalRole = resolved.terminalRole;

  try {
    await notifyServiceProviderProductRequestSubmitted({
      db,
      userId,
      productName,
      requestId,
      category: String(category || '').trim().toLowerCase() || null,
      unit: String(unit || '').trim().toLowerCase() || null,
      brand: resolvedBrand || brand || null,
      boqId: boqId || null
    });
  } catch (spNotifError) {
    console.error('[BOQ Product Request] Failed to notify requesting service provider:', spNotifError);
  }

  const supplierResult = await notifyTerminalSuppliersAboutProductRequest({
    db,
    request: {
      name: productName,
      category: String(category).trim().toLowerCase(),
      unit: String(unit).trim().toLowerCase(),
      description: description || '',
      boqId: boqId || null,
      requestedByServiceProviderId: userId
    },
    brandName: resolvedBrand,
    terminalRole,
    serviceProvider
  });

  const { notifiedCount: suppliersNotified, notifyScope } = supplierResult;

  console.log(
    `[BOQ Product Request] Notified ${suppliersNotified} supplier(s) for "${productName}" (brand: ${resolvedBrand || 'n/a'}, scope: ${notifyScope}, role: ${terminalRole || 'none'})`
  );

  return {
    suppliersNotified,
    notifyScope,
    terminalRole,
    resolvedBrand,
    message: suppliersNotified
      ? buildSuccessMessage({
          productName,
          suppliersNotified,
          terminalRole,
          notifyScope
        })
      : null
  };
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
    const { name, boqId } = payload;

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

    const productName = name.trim();
    const requestKey = buildBoqProductRequestKey({
      boqId: payload.boqId || null,
      boqItemId: payload.boqItemId ?? null,
      name: productName
    });

    const existingRequest = await findExistingBoqProductRequest(supabase, req.userId, {
      boqId: payload.boqId || null,
      boqItemId: payload.boqItemId ?? null,
      name: productName
    });
    if (existingRequest) {
      return res.status(409).json({
        status: 'error',
        alreadyRequested: true,
        message: 'You have already made a request for this product.'
      });
    }

    const recordedRequest = await recordBoqProductRequest(supabase, req.userId, {
      ...payload,
      name: productName
    });

    const { count: supplierCount, error: supplierCountError } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('user_type', 'supplier');
    if (supplierCountError) throw supplierCountError;
    if (!supplierCount) {
      return res.status(404).json({
        status: 'error',
        message: 'No suppliers are registered on the platform yet.'
      });
    }

    res.status(201).json({
      status: 'success',
      message: buildPendingSuccessMessage(productName),
      asyncDelivery: true,
      requestKey
    });

    void deliverProductRequestNotifications({
      db: supabase,
      userId: req.userId,
      payload,
      productName,
      requestId: recordedRequest?.id || null
    }).catch((error) => {
      console.error('[BOQ Product Request] Background delivery failed:', error);
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
