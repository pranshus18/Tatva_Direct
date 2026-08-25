import { afterEach, describe, expect, it } from 'vitest';
import {
  persistSupplierSelectBackOrigin,
  rememberSpPathForSupplierSelectBack,
  resolveSupplierSelectBack,
  SUPPLIER_SELECT_BACK
} from './supplierSelectBack';

afterEach(() => {
  sessionStorage.clear();
});

describe('resolveSupplierSelectBack', () => {
  it('keeps cart as the back target during cart handoff', () => {
    expect(
      resolveSupplierSelectBack({
        cartSupplierHandoff: true,
        location: { state: { fromBoqDetail: true, supplierSelectOrigin: 'dashboard' } }
      })
    ).toEqual(SUPPLIER_SELECT_BACK.cart);
  });

  it('returns Back to BOQ when continuing from BOQ Normalize', () => {
    expect(
      resolveSupplierSelectBack({
        location: {
          state: {
            supplierSelectOrigin: 'boq',
            supplierSelectItems: [{ id: '1' }]
          }
        }
      })
    ).toEqual(SUPPLIER_SELECT_BACK.boq);
  });

  it('returns Back to Dashboard when a dashboard BOQ opens Find suppliers', () => {
    expect(
      resolveSupplierSelectBack({
        location: {
          state: {
            fromBoqDetail: true,
            supplierSelectOrigin: 'dashboard',
            supplierSelectReturnTo: '/dashboard',
            supplierSelectItems: [{ id: '1' }]
          }
        }
      })
    ).toEqual(SUPPLIER_SELECT_BACK.dashboard);
  });

  it('treats fromBoqDetail without origin as dashboard', () => {
    expect(
      resolveSupplierSelectBack({
        location: { state: { fromBoqDetail: true, supplierSelectItems: [{ id: '1' }] } }
      })
    ).toEqual(SUPPLIER_SELECT_BACK.dashboard);
  });

  it('returns Back to BOQ from BOQ item handoff without an origin flag', () => {
    expect(
      resolveSupplierSelectBack({
        location: { state: { supplierSelectItems: [{ id: '1' }] } }
      })
    ).toEqual(SUPPLIER_SELECT_BACK.boq);
  });

  it('uses the last SP page for sidebar navigation from dashboard', () => {
    expect(
      resolveSupplierSelectBack({ lastPath: '/dashboard' })
    ).toEqual(SUPPLIER_SELECT_BACK.dashboard);
  });

  it('uses the last SP page for sidebar navigation from BOQ', () => {
    expect(
      resolveSupplierSelectBack({ lastPath: '/boq-normalize' })
    ).toEqual(SUPPLIER_SELECT_BACK.boq);
  });

  it('defaults to dashboard when the source is unknown', () => {
    expect(resolveSupplierSelectBack()).toEqual(SUPPLIER_SELECT_BACK.dashboard);
  });
});

describe('supplier select back session helpers', () => {
  it('does not remember supplier-select as the previous page', () => {
    rememberSpPathForSupplierSelectBack('/dashboard');
    rememberSpPathForSupplierSelectBack('/supplier-select');
    expect(resolveSupplierSelectBack({ lastPath: sessionStorage.getItem('tatvaSpPathBeforeSupplierSelect') })).toEqual(
      SUPPLIER_SELECT_BACK.dashboard
    );
  });

  it('reads a persisted origin when no router state is present', () => {
    persistSupplierSelectBackOrigin('boq');
    expect(
      resolveSupplierSelectBack({
        persistedOrigin: sessionStorage.getItem('tatvaSupplierSelectBackOrigin')
      })
    ).toEqual(SUPPLIER_SELECT_BACK.boq);
  });
});
