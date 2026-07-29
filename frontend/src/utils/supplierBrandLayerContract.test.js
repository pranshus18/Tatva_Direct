import { describe, expect, it } from 'vitest';
import {
  resolveSupplierBrandSetupLayers,
  supplierCanSelectBrandRoles,
  supplierHasBrandAccess
} from './supplierBrandLayerContract';

describe('supplierBrandLayerContract — layer boundaries', () => {
  it('Layer 2: catalog membership grants access even when meta is still pending', () => {
    const layers = resolveSupplierBrandSetupLayers({
      brandName: 'Samsung',
      catalogBrands: [{ name: 'Samsung', status: 'approved', hasAdminSupplyChain: true }],
      supplierApprovedBrands: [],
      supplierBrandRequests: [{ name: 'Samsung', status: 'pending' }],
      brandMeta: { status: 'pending', approvalStatus: 'pending', brand: 'Samsung' }
    });
    expect(layers.inApprovedCatalog).toBe(true);
    expect(layers.supplierHasAccess).toBe(true);
    expect(layers.canSelectRoles).toBe(true);
  });

  it('Layer 2: supplierApprovedBrands wins over stale pending brandMeta', () => {
    expect(
      supplierHasBrandAccess({
        brandName: 'samsung',
        catalogBrands: [],
        supplierApprovedBrands: [{ name: 'samsung', status: 'approved' }],
        supplierBrandRequests: [{ name: 'samsung', status: 'pending' }],
        brandMeta: { status: 'pending', brand: 'samsung' }
      })
    ).toBe(true);
  });

  it('Layer 2: genuine rejection blocks access', () => {
    expect(
      supplierHasBrandAccess({
        brandName: 'MysteryBrand',
        catalogBrands: [],
        supplierApprovedBrands: [],
        supplierBrandRequests: [
          { name: 'MysteryBrand', status: 'rejected', rejectionReason: 'Incomplete documents' }
        ],
        brandMeta: { status: 'rejected' }
      })
    ).toBe(false);
  });

  it('Layer 2: duplicate-of-approved rejection does not block canonical brand', () => {
    expect(
      supplierHasBrandAccess({
        brandName: 'Samsung',
        catalogBrands: [{ name: 'Samsung', status: 'approved' }],
        supplierApprovedBrands: [{ name: 'Samsung', status: 'approved' }],
        supplierBrandRequests: [
          {
            name: 'samsung',
            status: 'rejected',
            rejectionReason: 'Duplicate of approved brand "Samsung".'
          }
        ],
        brandMeta: { status: 'approved', brand: 'Samsung' }
      })
    ).toBe(true);
  });

  it('Layer 3: access without chain cannot select roles', () => {
    expect(
      supplierCanSelectBrandRoles({
        brandName: 'Titan',
        catalogBrands: [{ name: 'Titan', status: 'approved', hasAdminSupplyChain: false }],
        supplierApprovedBrands: [{ name: 'Titan', status: 'approved' }],
        brandMeta: {
          approvalStatus: 'approved',
          status: 'approved',
          supplierHasAccess: true,
          hasSupplyChainDefinition: false,
          canSelectRoles: false,
          roles: []
        }
      })
    ).toBe(false);
  });

  it('Layer 3: stale API canSelectRoles=false does not block when catalog has chain', () => {
    expect(
      supplierCanSelectBrandRoles({
        brandName: 'Samsung',
        catalogBrands: [{ name: 'Samsung', status: 'approved', hasAdminSupplyChain: true }],
        supplierApprovedBrands: [{ name: 'Samsung', status: 'approved' }],
        brandMeta: {
          approvalStatus: 'pending',
          status: 'pending',
          supplierHasAccess: false,
          hasSupplyChainDefinition: true,
          canSelectRoles: false,
          roles: ['dealer']
        }
      })
    ).toBe(true);
  });

  it('Layer 3: API canSelectRoles unlocks role picker when access is present', () => {
    const layers = resolveSupplierBrandSetupLayers({
      brandName: 'Fossil',
      catalogBrands: [{ name: 'Fossil', status: 'approved', hasAdminSupplyChain: true }],
      supplierApprovedBrands: [{ name: 'Fossil', status: 'approved' }],
      brandMeta: {
        approvalStatus: 'approved',
        status: 'approved',
        supplierHasAccess: true,
        hasSupplyChainDefinition: true,
        canSelectRoles: true,
        roles: ['dealer', 'retailer']
      }
    });
    expect(layers.canSelectRoles).toBe(true);
    expect(layers.roles).toEqual(['dealer', 'retailer']);
  });
});
