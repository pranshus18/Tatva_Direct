import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChainRoleOptionsMessage,
  resolveSupplierBrandLayers
} from '../services/supplierBrandLayerContract.js';

describe('resolveSupplierBrandLayers — layer boundaries', () => {
  it('Layer 1: approved brands-table row is in catalog even without a chain', () => {
    const layers = resolveSupplierBrandLayers({
      brandInput: 'Samsung',
      brandRow: { name: 'Samsung', status: 'approved' },
      chainRow: null
    });
    assert.equal(layers.inApprovedCatalog, true);
    assert.equal(layers.supplierHasAccess, true);
    assert.equal(layers.hasSupplyChainDefinition, false);
    assert.equal(layers.canSelectRoles, false);
    assert.equal(layers.approvalStatus, 'approved');
    assert.equal(layers.status, 'approved');
  });

  it('Layer 1: admin chain for a spelling variant does not apply to a different brand', () => {
    const layers = resolveSupplierBrandLayers({
      brandInput: 'Phillips',
      brandRow: { name: 'Phillips', status: 'pending' },
      chainRow: {
        category_name: 'Philips',
        stages: [{ role: 'dealer' }, { role: 'retailer' }]
      }
    });
    assert.equal(layers.inApprovedCatalog, false);
    assert.equal(layers.supplierHasAccess, false);
    assert.equal(layers.canSelectRoles, false);
    assert.equal(layers.approvalStatus, 'pending');
    assert.equal(layers.status, 'pending');
  });

  it('Layer 1: exact brand name still uses its own admin chain', () => {
    const layers = resolveSupplierBrandLayers({
      brandInput: 'Philips',
      brandRow: { name: 'Philips', status: 'pending' },
      chainRow: {
        category_name: 'Philips',
        stages: [{ role: 'dealer' }, { role: 'retailer' }]
      }
    });
    assert.equal(layers.inApprovedCatalog, true);
    assert.equal(layers.hasSupplyChainDefinition, true);
    assert.equal(layers.canSelectRoles, true);
    assert.equal(layers.approvalStatus, 'pending');
    assert.deepEqual(layers.roles, ['dealer', 'retailer']);
  });

  it('Layer 3: pending brand without chain cannot select roles', () => {
    const layers = resolveSupplierBrandLayers({
      brandInput: 'Mystery',
      brandRow: { name: 'Mystery', status: 'pending' },
      chainRow: null
    });
    assert.equal(layers.inApprovedCatalog, false);
    assert.equal(layers.supplierHasAccess, false);
    assert.equal(layers.canSelectRoles, false);
    assert.equal(layers.approvalStatus, 'pending');
  });

  it('does not treat role availability as brands-table approval', () => {
    const layers = resolveSupplierBrandLayers({
      brandInput: 'Acme',
      brandRow: { name: 'Acme', status: 'rejected' },
      chainRow: {
        category_name: 'Acme',
        stages: [{ role: 'stockist' }]
      }
    });
    // Rejected brands-table row: access only via chain catalog membership.
    assert.equal(layers.approvalStatus, 'rejected');
    assert.equal(layers.status, 'rejected');
    assert.equal(layers.hasSupplyChainDefinition, true);
    assert.equal(layers.canSelectRoles, layers.supplierHasAccess && layers.hasSupplyChainDefinition);
  });
});

describe('buildChainRoleOptionsMessage', () => {
  it('separates access vs chain-definition messages', () => {
    assert.match(
      buildChainRoleOptionsMessage({
        canSelectRoles: false,
        supplierHasAccess: false,
        hasSupplyChainDefinition: false,
        displayBrandName: 'X'
      }),
      /not yet been approved/i
    );
    assert.match(
      buildChainRoleOptionsMessage({
        canSelectRoles: false,
        supplierHasAccess: true,
        hasSupplyChainDefinition: false,
        displayBrandName: 'X'
      }),
      /not defined by admin/i
    );
    assert.equal(
      buildChainRoleOptionsMessage({
        canSelectRoles: true,
        supplierHasAccess: true,
        hasSupplyChainDefinition: true,
        displayBrandName: 'X'
      }),
      null
    );
  });
});
