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
import { findAdmins } from '../repositories/usersRepository.js';

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

/** @deprecated Use resolveBrandAndTerminalRoleForProductRequest */
export async function inferBrandNameForProductRequest(db, productName, explicitBrand) {
  const resolved = await resolveBrandAndTerminalRoleForProductRequest(db, productName, explicitBrand);
  return resolved.brandName;
}

/** @deprecated Use resolveBrandAndTerminalRoleForProductRequest */
export async function resolveTerminalRoleForBrand(db, brandName) {
  const resolved = await resolveBrandAndTerminalRoleForProductRequest(db, brandName, brandName);
  return resolved.terminalRole;
}

export function filterSuppliersAtTerminalRole(suppliers, brandName, terminalRole) {
  if (!terminalRole) return [];

  const list = Array.isArray(suppliers) ? suppliers : [];
  const brandMatches = list.filter((supplier) =>
    profileHasRoleForBrand(supplier?.profile, terminalRole, brandName)
  );
  if (brandMatches.length > 0) return brandMatches;

  // Brand-specific match failed — still notify suppliers in the configured terminal role.
  return list.filter((supplier) => profileHasRoleForBrand(supplier?.profile, terminalRole, null));
}

export async function notifyTerminalSuppliersAboutProductRequest({
  db,
  product,
  brandName,
  terminalRole,
  serviceProvider
}) {
  if (!terminalRole) {
    return { notifiedCount: 0, terminalRole: null };
  }

  const { data: suppliers, error } = await db
    .from('users')
    .select('id, name, company, profile')
    .eq('user_type', 'supplier');
  if (error) throw error;

  const terminalSuppliers = filterSuppliersAtTerminalRole(suppliers || [], brandName, terminalRole);
  if (!terminalSuppliers.length) {
    return { notifiedCount: 0, terminalRole };
  }

  const roleLabel = SUPPLY_CHAIN_ROLE_LABELS[terminalRole] || terminalRole;
  const requesterLabel =
    serviceProvider?.company || serviceProvider?.name || serviceProvider?.email || 'A service provider';
  const brandHint = brandName ? ` for brand "${brandName}"` : '';

  const notifications = terminalSuppliers.map((supplier) => ({
    user_id: supplier.id,
    type: 'product_request',
    title: `Customer looking for: ${product.name}`,
    message:
      `${requesterLabel} is looking for "${product.name}"${brandHint}. ` +
      `As the ${roleLabel} (last role in the supply chain), please add this product with your price, stock, and location in the supplier portal so it can be matched in upcoming BOQs.`,
    related_product_id: product.id,
    metadata: {
      productId: product.id,
      productName: product.name,
      productCategory: product.category,
      productUnit: product.unit,
      brandName: brandName || null,
      terminalRole,
      requestedByServiceProviderId: product.requested_by_service_provider_id || null,
      source: 'service_provider_boq_request_terminal_suppliers'
    },
    is_read: false
  }));

  await insertNotifications(notifications, db);
  return { notifiedCount: notifications.length, terminalRole };
}

export async function notifyAdminsAboutProductRequest({
  db,
  product,
  serviceProvider,
  boqId,
  adminEmail
}) {
  const { data: admins } = await findAdmins(adminEmail, db);
  if (!admins?.length) return 0;

  const notifications = admins.map((admin) => ({
    user_id: admin.id,
    type: 'product_approval',
    title: `New Product Requested by Service Provider: ${product.name}`,
    message: `${serviceProvider?.name || 'A service provider'} (${serviceProvider?.company || serviceProvider?.email || ''}) has requested a new product "${product.name}" in category "${product.category}". Please review and approve it so terminal suppliers can add their offers.`,
    related_product_id: product.id,
    related_supplier_id: null,
    metadata: {
      productId: product.id,
      productName: product.name,
      productCategory: product.category,
      productUnit: product.unit,
      requestedByServiceProviderId: product.requested_by_service_provider_id,
      requestedByServiceProviderName: serviceProvider?.name,
      requestedByServiceProviderCompany: serviceProvider?.company,
      requestedByServiceProviderEmail: serviceProvider?.email,
      source: 'service_provider_boq_request',
      boqId: boqId || null
    },
    is_read: false
  }));

  await insertNotifications(notifications, db);
  return notifications.length;
}
