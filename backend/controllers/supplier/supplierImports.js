/** Shared static imports for supplier route modules. */
export { default as crypto } from 'crypto';
export {
  getInvalidPrimaryStatusTransitionMessage,
  isCancelledOrderStatus,
  isValidPrimaryOrderStatus,
  isValidPrimaryStatusTransition,
  toLifecycleStateFromStatus
} from '../../utils/orderLifecycle.js';
export { default as logger } from '../../utils/logger.js';
export {
  supplierBcovLevelsUpsertSchema,
  supplierBcovResolvePriceSchema,
  supplierCategoryCreateSchema,
  supplierInventoryAdjustSchema,
  supplierOutletCreateSchema,
  supplierOutletDeleteSchema,
  supplierOutletRepairGeoSchema,
  supplierOutletUpdateSchema,
  supplierOrderStatusPatchSchema,
  supplierProductAiEnhanceSchema,
  supplierProductAnalyzeImageSchema,
  supplierProductCreateSchema,
  supplierProductDeleteSchema,
  supplierProductExtractSpecificationsSchema,
  supplierProductUpdateSchema,
  supplierUpstreamCartSaveSchema,
  supplierReturnStatusPatchSchema,
  supplierUnitCreateSchema,
  supplierUpstreamCheckoutReleaseSchema,
  supplierUpstreamCheckoutReserveSchema,
  supplierUpstreamOrdersSchema,
  supplierUpstreamPreviewGroupsSchema
} from '../../contracts/supplierContracts.js';
export { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
export { recordInventoryMovement } from '../../services/inventoryService.js';
export { applyRestockForClosedReturn } from '../../services/returnInventoryService.js';
export { maybeNotifyInventoryBelowMov } from '../../services/lowInventoryMovAlertService.js';
export { retrySupabaseQuery } from '../../services/db.js';
export {
  LISTED_SUPPLIER_PRODUCTS_OR,
  listedSupplierProductsFilterOptions
} from '../../utils/platformListedSupplierProductsFilter.js';
export { searchProductDiscoveryForUser } from '../../services/productDiscoverySearchService.js';
export { getProductDiscoveryDetail } from '../../services/productDiscoveryDetailService.js';
export { generateAndAttachReceiptPdf, RECEIPT_PDF_LAYOUT_VERSION } from '../../services/receiptPdfService.js';
export {
  buildIdentityBundle,
  buildSupplierVariantIdentity,
  buildVariantAsinLikeId,
  normalizeVariantAttributes
} from '../../services/productIdentityService.js';
export {
  validateSpecValues,
  scoreOnboardingConfidence,
  decideOnboardingAction
} from '../../services/catalogOnboardingService.js';
export {
  haversineKm,
  resolveGeoFromOutletAddress,
  isValidGeoLocation,
  geocodeAddressNominatim,
  buildOutletAddressString,
  getMinDrivingDistanceFromOriginsKm
} from '../../utils/geoUtils.js';
export { getMinimumOrderValueInrForSellerRole } from '../../utils/supplierProfile.js';
export {
  baselineChainFromProfile,
  buildEffectiveSupplierChainProfile,
  fetchPendingChainRequest,
  loadEffectiveSupplierChainProfile
} from '../../services/supplierChainProfileService.js';
export { resolveSupplierProductBrandGuard } from '../../services/supplierBrandGuardService.js';
export {
  fetchClosedReturnQuantityByOrderItem,
  getNetItemMetrics,
  buildOrderNetRevenueMap
} from '../../utils/netRevenue.js';
export { normalizeBrandKey } from '../../services/supplyChainSharedService.js';
export {
  composeBcovNotes,
  isCatalogGuardrailsEnabled,
  isValidGtin,
  normalizeBcovBrand,
  normalizeGtin,
  normalizeModelIdentifier,
  normalizeText,
  onboardingAutoApproveThreshold,
  parseBcovNotes,
  buildSpecificationTemplateFromFields,
  countMeaningfulSpecValues,
  mergeSpecificationMaps,
  mergeOrderItemSpecificationsForDisplay,
  parseSpecificationsObject,
  sanitizeSpecifications,
  toFiniteNumber
} from '../../services/supplierCatalogHelpersService.js';
export { notifyAdminsForPortalAction } from '../../services/portalActivityService.js';
export {
  extractSpecificationPairsFromDescription,
  extractSpecificationValuesFromDescription
} from '../../services/supplierAiSpecExtractionService.js';
export { ensureBrandApprovedOrRequest, resolveBrandApprovalStatus } from '../../services/brandApprovalService.js';
export { insertNotification, insertNotifications } from '../../repositories/notificationsRepository.js';
export { findAdmins, findUserBasicById } from '../../repositories/usersRepository.js';
export {
  fetchVariantCatalogMrp,
  resolveVariantProductCovEligibility,
  validateAndNormalizeBcovLevels,
  deleteSupplierBcovLevelsForVariant,
  selectBcovLevelsForSupplierOffer
} from '../../services/supplierBcovService.js';
export {
  parseCovThresholdNumber,
  resolveBcovPriceForBuyerMetrics
} from '../../services/procurementSharedService.js';
export {
  brandIsAllowedForSupplier,
  entryOverlapsViewerBrands,
  getViewerBrandTokensForRole,
  supplierCanAccessBrandStrict,
  supplierHasSelectedRoleForBrand,
  normalizeChainNameKey,
  normalizeBrandKeyFromAttributes,
  parseBrandTokens,
  resolveUpstreamBrandLabel,
  SUPPLIER_ROLE_REQUIRED_FOR_PRODUCT_CODE,
  SUPPLIER_ROLE_REQUIRED_FOR_PRODUCT_MESSAGE
} from '../../services/supplierBrandGuardService.js';
export {
  dedupeUpstreamCandidatesBySupplierPreferClosest,
  getFirstSupplierBranchAddressText,
  minHaversineKmBuyerOutletsToSeller,
  rankUpstreamOffersForProduct,
  SUPPLY_CHAIN_ROLE_LABELS,
  UPSTREAM_RANK_PRIORITY
} from '../../services/supplierUpstreamRankingService.js';
export { mapSupplyChainPartner } from '../../services/supplierPartnerMapperService.js';
export {
  buildSupplyChainPartnerGroups,
  buildRegisteredUpstreamPartnerIdsByBrandKey,
  buildNoUpstreamOffersMessage,
  buildUpstreamChainContextForMineOffer,
  collectRequiredUpstreamRolesFromContexts,
  formatUpstreamRoleLabel,
  formatUpstreamRoleLabels,
  getAllowedUpstreamRolesForBrand,
  getImmediateUpstreamRoleForBrand,
  getUpstreamRolesForBuyerOnBrand,
  pickAnyUpstreamSellerRoleOnChain,
  pickUpstreamSellerRoleForBrand,
  sellerHasAnyUpstreamRoleForBrand,
  sellerHasRoleForBrand,
  sellerMatchesUpstreamForBrand
} from '../../services/supplyChainPartnerGroupsService.js';
export {
  buildAllowedUpstreamRolesSet,
  getImmediateParentRolesUnion,
  getMySupplierRoles,
  getViewerBrandTokensUnionForAllRoles,
  loadAdminBrandChainsByName,
  normalizeChainRolesFromStages,
  PARENT_ROLE_BY_MY_ROLE,
  pickDisplayRoleFromAllowedSet,
  pickMatchingUpstreamRoleForSeller,
  resolveBuyerRoleForBrand,
  resolveRequiredUpstreamRoleFromAdminChain,
  ROLE_DEPTH,
  sellerMatchesUpstreamRoles,
  sortRolesByChainDepthDesc,
  SUPPLIER_ROLE_SET,
  userHasSupplierRole
} from '../../services/supplierChainRoutingService.js';
export {
  shouldMoveToPendingForSpecChange,
  shouldAutoApproveSupplierOfferOnCreate,
  shouldRequireApprovalForVariantSpecChange,
  shouldRecomputeSupplierVariantKeyOnUpdate,
  hasSupplierSpecificationChangesFromCatalog,
  submittedSpecsCompatibleWithExistingVariant,
  areSpecificationsEqual,
  findBestMatchingApprovedOfferForSpecs,
  specificationsAgreeOnOverlappingKeys,
  retainCatalogCompatibleSpecifications
} from '../../utils/supplierProductApproval.js';
export { PRODUCT_IMAGES_BUCKET, uploadFile } from '../../services/storage.js';
