import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductDiscoveryDetail from './ProductDiscoveryDetail';

const DETAIL_PAYLOAD = {
  status: 'success',
  audience: 'supplier_upstream',
  product: {
    id: 'prod-1',
    name: 'Steel Taurus 600',
    brand: 'Milton',
    category: 'Flasks & Bottles',
    unit: '600 ml',
    description: 'Vacuum insulated steel bottle.',
    priceRange: { min: 120, max: 120 },
    supplierCount: 2,
    canAddToCart: true
  },
  family: null,
  hasVariants: false,
  variantCount: 1,
  variantOptions: [],
  viewerListings: [
    {
      id: 'mine-9',
      productId: 'prod-1',
      variantAsin: null,
      price: 120,
      stock: 110,
      unit: '600 ml'
    }
  ],
  variants: [
    {
      productId: 'prod-1',
      name: 'Steel Taurus 600',
      variantKey: null,
      specifications: { color: 'Silver' },
      images: [],
      price: 120,
      stock: 110,
      unit: '600 ml',
      min_order_quantity: 1,
      location: 'Pune',
      supplierCount: 2,
      canAddToCart: true
    }
  ]
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderUpstreamDetail(initialUrl = '/supplier-upstream/product/prod-1?mine=mine-9') {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route
          path="/supplier-upstream/product/:productId"
          element={<ProductDiscoveryDetail portal="supplier" />}
        />
        <Route path="/supplier-upstream" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.setItem('token', 'test-token');
  sessionStorage.clear();
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(DETAIL_PAYLOAD) })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('ProductDiscoveryDetail in the supplier upstream portal', () => {
  it('loads the product from the supplier upstream detail endpoint', async () => {
    renderUpstreamDetail();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Steel Taurus 600' })).toBeInTheDocument()
    );

    const requestedUrl = String(global.fetch.mock.calls[0][0]);
    expect(requestedUrl).toContain('/api/supplier/upstream/products/prod-1/detail');
    expect(screen.getByText(/Brand:/)).toHaveTextContent('Milton');
    expect(screen.getByRole('button', { name: /Back to upstream sourcing/i })).toBeInTheDocument();
    expect(screen.getAllByText('₹120.00 per 600 ml').length).toBeGreaterThan(0);
  });

  it('opens the variant from the URL when multiple offers share a catalog product', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ...DETAIL_PAYLOAD,
            hasVariants: true,
            variantCount: 2,
            variantOptions: [{ key: 'capacity', label: 'Capacity', values: ['600 ml', '1 L'] }],
            viewerListings: [
              {
                id: 'mine-600',
                productId: 'prod-1',
                variantKey: 'silver-600',
                variantAsin: 'TS1B2N',
                name: 'Steel Taurus 600',
                price: 150,
                stock: 80,
                unit: '600 ml'
              }
            ],
            variants: [
              {
                productId: 'prod-1',
                name: 'Steel Taurus 1L',
                variantKey: 'silver-1000',
                variantAsin: 'TS1B1H',
                specifications: { capacity: '1 L' },
                images: [],
                price: 100,
                stock: 50,
                unit: '1 L',
                min_order_quantity: 1,
                supplierCount: 1,
                canAddToCart: true
              },
              {
                productId: 'prod-1',
                name: 'Steel Taurus 600',
                variantKey: 'silver-600',
                variantAsin: 'TS1B2N',
                specifications: { capacity: '600 ml' },
                images: [],
                price: 150,
                stock: 80,
                unit: '600 ml',
                min_order_quantity: 1,
                supplierCount: 1,
                canAddToCart: true
              }
            ]
          })
      })
    );

    renderUpstreamDetail(
      '/supplier-upstream/product/prod-1?variant=silver-600&mine=mine-600'
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Steel Taurus 600' })).toBeInTheDocument()
    );
    expect(screen.queryByRole('heading', { name: 'Steel Taurus 1L' })).not.toBeInTheDocument();
    expect(screen.getAllByText('₹150.00 per 600 ml').length).toBeGreaterThan(0);
  });

  it('does not copy a saved cart quantity into the stepper on load', async () => {
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/api/supplier/upstream/cart')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              status: 'success',
              cart: {
                draft: {
                  projects: [
                    {
                      projectId: 'proj-1',
                      items: [{ mineSupplierProductId: 'mine-9', quantity: 3 }]
                    }
                  ]
                }
              }
            })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DETAIL_PAYLOAD) });
    });

    renderUpstreamDetail();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Steel Taurus 600' })).toBeInTheDocument()
    );
    await waitFor(() =>
      expect(screen.getAllByText(/In cart: 3/).length).toBeGreaterThan(0)
    );
    const qtyValues = document.querySelectorAll('.pdd-buybox__qty-value');
    expect([...qtyValues].some((node) => node.textContent.trim() === '1')).toBe(true);
    expect([...qtyValues].some((node) => node.textContent.trim() === '3')).toBe(false);
    expect(screen.queryByRole('button', { name: /Update Cart/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Continue sourcing/i }).length).toBeGreaterThan(0);
  });

  it('hands the listing back to the sourcing cart flow with the chosen quantity', async () => {
    renderUpstreamDetail();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Steel Taurus 600' })).toBeInTheDocument()
    );

    const increaseButtons = screen.getAllByRole('button', { name: /Increase procurement quantity/i });
    fireEvent.click(increaseButtons[0]);
    const continueButtons = await screen.findAllByRole('button', { name: /Continue sourcing/i });
    fireEvent.click(continueButtons[0]);

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/supplier-upstream?add=mine-9&qty=2')
    );
  });

  it('shows last ordered quantity separately after the listing leaves the cart', async () => {
    sessionStorage.setItem('supplierUpstreamLastOrderedQty', JSON.stringify({ 'mine-9': 4 }));
    global.fetch = vi.fn((url) => {
      if (String(url).includes('/api/supplier/upstream/cart')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ status: 'success', cart: { draft: { projects: [] } } })
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(DETAIL_PAYLOAD) });
    });

    renderUpstreamDetail();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Steel Taurus 600' })).toBeInTheDocument()
    );
    expect(screen.getAllByText(/Last ordered: 4/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/this is not in your cart/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Continue sourcing/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Update Cart/i })).not.toBeInTheDocument();
  });

  it('surfaces a missing product without service-provider wording', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, json: () => Promise.resolve({ status: 'error', message: 'Product not found' }) })
    );

    renderUpstreamDetail();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Product not found' })).toBeInTheDocument()
    );
    expect(
      screen.getByText('This product may have been removed or is no longer available in the catalog.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Return to upstream sourcing/i })
    ).toBeInTheDocument();
  });
});
