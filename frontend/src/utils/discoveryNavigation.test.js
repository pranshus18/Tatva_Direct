import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  DISCOVERY_PATH,
  UPSTREAM_SOURCING_PATH,
  buildProductDetailUrl,
  buildUpstreamProductDetailUrl,
  buildUpstreamSourcingUrl,
  openUpstreamProductDetailInNewTab,
  resolveUpstreamReturnPath
} from './discoveryNavigation';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('service provider discovery links', () => {
  it('keeps the discovery detail path and return param', () => {
    const url = new URL(buildProductDetailUrl('prod-1', DISCOVERY_PATH));
    expect(url.pathname).toBe(`${DISCOVERY_PATH}/prod-1`);
    expect(url.searchParams.get('return')).toBe(DISCOVERY_PATH);
  });
});

describe('upstream sourcing product detail links', () => {
  it('builds a supplier detail url carrying variant and own listing id', () => {
    const url = new URL(
      buildUpstreamProductDetailUrl('prod-1', {
        variantKey: 'color:red',
        mineSupplierProductId: 'mine-9',
        returnPath: UPSTREAM_SOURCING_PATH
      })
    );

    expect(url.pathname).toBe(`${UPSTREAM_SOURCING_PATH}/product/prod-1`);
    expect(url.searchParams.get('variant')).toBe('color:red');
    expect(url.searchParams.get('mine')).toBe('mine-9');
    expect(url.searchParams.get('return')).toBe(UPSTREAM_SOURCING_PATH);
  });

  it('omits empty optional params and rejects a missing product id', () => {
    const url = new URL(buildUpstreamProductDetailUrl('prod-1'));
    expect(url.searchParams.has('variant')).toBe(false);
    expect(url.searchParams.has('mine')).toBe(false);
    expect(buildUpstreamProductDetailUrl('   ')).toBeNull();
  });

  it('falls back to the sourcing list when the return path points at another detail page', () => {
    const url = new URL(
      buildUpstreamProductDetailUrl('prod-2', {
        returnPath: `${UPSTREAM_SOURCING_PATH}/product/prod-1?mine=mine-1`
      })
    );
    expect(url.searchParams.get('return')).toBe(UPSTREAM_SOURCING_PATH);
  });

  it('reports whether the detail tab actually opened', () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    expect(openUpstreamProductDetailInNewTab('prod-1')).toBe(false);

    openSpy.mockReturnValue({});
    expect(openUpstreamProductDetailInNewTab('prod-1')).toBe(true);
    expect(openUpstreamProductDetailInNewTab('')).toBe(false);
  });
});

describe('returning to upstream sourcing', () => {
  it('only trusts return paths inside the sourcing page', () => {
    expect(resolveUpstreamReturnPath(new URLSearchParams('return=/supplier-upstream?tab=all'))).toBe(
      '/supplier-upstream?tab=all'
    );
    expect(resolveUpstreamReturnPath(new URLSearchParams('return=/admin-dashboard'))).toBe(
      UPSTREAM_SOURCING_PATH
    );
    expect(resolveUpstreamReturnPath(new URLSearchParams())).toBe(UPSTREAM_SOURCING_PATH);
  });

  it('hands a listing back to the sourcing cart dialog', () => {
    expect(buildUpstreamSourcingUrl({ addSupplierProductId: 'mine-9' })).toBe(
      `${UPSTREAM_SOURCING_PATH}?add=mine-9`
    );
    expect(buildUpstreamSourcingUrl()).toBe(UPSTREAM_SOURCING_PATH);
  });
});
