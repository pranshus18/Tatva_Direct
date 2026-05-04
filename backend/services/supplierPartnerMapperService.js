import { entryOverlapsViewerBrands } from './supplierBrandGuardService.js';
import { SUPPLY_CHAIN_ROLE_LABELS } from './supplierUpstreamRankingService.js';

export function mapSupplyChainPartner(user, chainRole, viewerBrandTokens) {
  const profile = user.profile || {};
  const address = user.address || {};

  const roleEntries = Array.isArray(profile.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  let rawMatching = roleEntries.filter((e) => e && e.role === chainRole);

  if (viewerBrandTokens && viewerBrandTokens.size > 0) {
    rawMatching = rawMatching.filter((e) => entryOverlapsViewerBrands(e, viewerBrandTokens));
  }

  if (rawMatching.length === 0 && profile.supplierRole === chainRole) {
    const legacyEntry = {
      id: 'legacy',
      role: chainRole,
      brands: profile.brands || '',
      gstin: profile.gstin || '',
      companyName: profile.companyName || '',
      ownershipDetails: profile.ownershipDetails || '',
      authorizationCertificateUrl: profile.authorizationCertificateUrl || ''
    };
    if (!viewerBrandTokens || viewerBrandTokens.size === 0 || entryOverlapsViewerBrands(legacyEntry, viewerBrandTokens)) {
      rawMatching = [legacyEntry];
    }
  }

  if (rawMatching.length === 0) return null;

  const entries = rawMatching.map((e) => ({
    id: e.id,
    role: e.role,
    roleLabel: e.role ? SUPPLY_CHAIN_ROLE_LABELS[e.role] || e.role : '',
    brands: e.brands || '',
    gstin: e.gstin || '',
    companyName: e.companyName || '',
    ownershipDetails: e.ownershipDetails || '',
    authorizationCertificateUrl: e.authorizationCertificateUrl || ''
  }));

  const first = rawMatching[0];
  const brandsSummary = rawMatching
    .map((e) => (e.brands || '').trim())
    .filter(Boolean)
    .join('; ');
  const ownershipSummary = rawMatching
    .map((e) => (e.ownershipDetails || '').trim())
    .filter(Boolean)
    .join('; ');
  const certFromEntries = rawMatching.map((e) => e.authorizationCertificateUrl).filter(Boolean);
  const authorizationCertificateUrl =
    certFromEntries.length === 1 ? certFromEntries[0] : certFromEntries.length > 1 ? '' : '';

  return {
    id: user.id,
    name: user.name,
    company: user.company || '',
    phone: user.phone || '',
    email: user.email || '',
    gstin: (first.gstin || '').trim() || '',
    address,
    city: address.city || '',
    state: address.state || '',
    pincode: address.pincode || address.postal_code || '',
    line1: address.line1 || address.street || address.address_line1 || '',
    brands: brandsSummary,
    ownershipDetails: ownershipSummary,
    authorizationCertificateUrl,
    supplierRole: chainRole,
    supplierRoleLabel: SUPPLY_CHAIN_ROLE_LABELS[chainRole] || chainRole,
    companyInfoEntries: entries
  };
}
