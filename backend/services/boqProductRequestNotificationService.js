import {
  getTerminalRoleFromStages
} from '../utils/adminBrandSupplyChain.js';
import { profileHasRoleForBrand } from '../controllers/boq/boqCore.js';
import {
  findCategorySupplyChainRowForBrandKey,
  normalizeBrandKey,
  SUPPLY_CHAIN_ROLE_LABELS
} from './supplyChainSharedService.js';
import { insertNotifications } from '../repositories/notificationsRepository.js';

async function loadSupplyChainRows(db) {
  const { data, error } = await db
    .from('category_supply_chains')
    .select('category_name, stages, updated_at');
  if (error) throw error;
  return data || [];
}

function matchSupplyChainRow(chainRows, brandName) {
  const wantedKey = normalizeBrandKey(brandName);
  if (!wantedKey) return null;
  return findCategorySupplyChainRowForBrandKey(chainRows, wantedKey);
}

export async function resolveBrandAndTerminalRoleForProductRequest(db, productName, explicitBrand) {
  const chainRows = await loadSupplyChainRows(db);

  const explicit = String(explicitBrand || '').trim();
  if (explicit) {
    const chainRow = matchSupplyChainRow(chainRows, explicit);
    return {
      brandName: chainRow?.category_name || explicit,
      terminalRole: chainRow ? getTerminalRoleFromStages(chainRow.stages) : null
    };
  }

  const nameKey = normalizeBrandKey(productName);
  if (!nameKey) {
    return { brandName: null, terminalRole: null };
  }

  const chainRow = findCategorySupplyChainRowForBrandKey(chainRows, nameKey);
  if (!chainRow) {
    return { brandName: null, terminalRole: null };
  }

  return {
    brandName: chainRow.category_name,
    terminalRole: getTerminalRoleFromStages(chainRow.stages)
  };
}

export function filterSuppliersAtTerminalRole(suppliers, brandName, terminalRole) {
  if (!terminalRole) return [];

  const list = Array.isArray(suppliers) ? suppliers : [];
  const brandMatches = list.filter((supplier) =>
    profileHasRoleForBrand(supplier?.profile, terminalRole, brandName)
  );
  if (brandMatches.length > 0) return brandMatches;

  return list.filter((supplier) => profileHasRoleForBrand(supplier?.profile, terminalRole, null));
}

export function resolveProductRequestRecipients(allSuppliers, brandName, terminalRole) {
  const list = Array.isArray(allSuppliers) ? allSuppliers : [];
  if (!list.length) {
    return { recipients: [], notifyScope: 'none' };
  }

  if (terminalRole) {
    const terminalMatches = filterSuppliersAtTerminalRole(list, brandName, terminalRole);
    if (terminalMatches.length > 0) {
      return { recipients: terminalMatches, notifyScope: 'terminal_role' };
    }
  }

  return { recipients: list, notifyScope: 'all_suppliers' };
}

export async function notifyTerminalSuppliersAboutProductRequest({
  db,
  request,
  brandName,
  terminalRole,
  serviceProvider
}) {
  const { data: suppliers, error } = await db
    .from('users')
    .select('id, name, company, profile')
    .eq('user_type', 'supplier');
  if (error) throw error;

  const { recipients, notifyScope } = resolveProductRequestRecipients(
    suppliers || [],
    brandName,
    terminalRole
  );

  if (!recipients.length) {
    return { notifiedCount: 0, terminalRole: terminalRole || null, notifyScope };
  }

  const roleLabel = terminalRole ? SUPPLY_CHAIN_ROLE_LABELS[terminalRole] || terminalRole : null;
  const requesterLabel =
    serviceProvider?.company || serviceProvider?.name || serviceProvider?.email || 'A customer';
  const brandHint = brandName ? ` for brand "${brandName}"` : '';
  const productName = String(request?.name || '').trim() || 'this product';

  const message =
    notifyScope === 'terminal_role' && roleLabel
      ? `${requesterLabel} is looking for "${productName}"${brandHint}. ` +
        `As the ${roleLabel} (last role in the supply chain), you can add this product with your price, stock, and location in the supplier portal if you stock it.`
      : `${requesterLabel} is looking for "${productName}"${brandHint}. ` +
        'If you stock this item, you can add it with your price, stock, and location in the supplier portal.';

  const notifications = recipients.map((supplier) => ({
    user_id: supplier.id,
    type: 'system',
    title: `Customer looking for: ${productName}`,
    message,
    related_product_id: null,
    metadata: {
      productName,
      productCategory: request?.category || null,
      productUnit: request?.unit || null,
      productDescription: request?.description || null,
      brandName: brandName || null,
      terminalRole: terminalRole || null,
      notifyScope,
      boqId: request?.boqId || null,
      requestedByServiceProviderId: request?.requestedByServiceProviderId || null,
      source: 'service_provider_boq_customer_lookup'
    },
    is_read: false
  }));

  await insertNotifications(notifications, db);
  return {
    notifiedCount: notifications.length,
    terminalRole: terminalRole || null,
    notifyScope
  };
}
