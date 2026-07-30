import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SupplierSupplyChainEntriesEditor from './SupplierSupplyChainEntriesEditor';

vi.mock('../hooks/useSupplierBrands', () => ({
  useSupplierBrands: () => ({
    brands: [{ name: 'acc', status: 'approved' }],
    brandNames: ['acc'],
    loading: false,
    error: '',
    reload: vi.fn()
  })
}));

vi.mock('./BrandSelect', () => ({
  default: function MockBrandSelect({ allowOther }) {
    return (
      <div data-testid="brand-select" data-allow-other={String(!!allowOther)}>
        Path A catalog picker
      </div>
    );
  }
}));

vi.mock('./BrandAuthorizationDocuments', () => ({
  default: () => null
}));

function makeProfile(brand = '') {
  return {
    companyInfoEntries: [
      {
        id: 'entry-1',
        brands: brand,
        role: '',
        gstin: '',
        companyName: '',
        ownershipDetails: '',
        minimumOrderValue: ''
      }
    ]
  };
}

function PathModeHarness({
  profileBrand = '',
  lockedBrandName = '',
  initialMode = null,
  onModeChange = null
}) {
  const [brandPathMode, setBrandPathMode] = useState(initialMode);
  const [profile, setProfile] = useState(() => makeProfile(profileBrand));

  return (
    <SupplierSupplyChainEntriesEditor
      profile={profile}
      setProfile={setProfile}
      editing
      sectionView="brand"
      selectionMode="dropdown"
      allowEntryManagement
      showAddEntry={false}
      catalogBrands={[{ name: 'acc', status: 'approved' }]}
      catalogBrandsLoading={false}
      catalogBrandsError=""
      onReloadCatalogBrands={vi.fn()}
      lockedBrandName={lockedBrandName}
      brandPathMode={brandPathMode}
      onBrandPathModeChange={(mode) => {
        setBrandPathMode(mode);
        onModeChange?.(mode);
      }}
    />
  );
}

describe('SupplierSupplyChainEntriesEditor Path A / Path B exclusivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('chooser mode shows Path A picker and Path B entry point', () => {
    render(<PathModeHarness />);

    expect(screen.getByText(/Path A — select approved brand/i)).toBeInTheDocument();
    expect(screen.getByTestId('brand-select')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Or use Path B — request a new brand/i })).toBeInTheDocument();
    expect(screen.queryByText(/Path A only/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Path B only/i)).not.toBeInTheDocument();
  });

  it('Path A mode hides Path B controls entirely', () => {
    render(
      <PathModeHarness profileBrand="acc" lockedBrandName="acc" initialMode="pathA" />
    );

    expect(screen.getByText(/Path A only/i)).toBeInTheDocument();
    expect(screen.getAllByText('acc').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Or use Path B/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Path B only/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('brand-select')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Change brand/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel setup/i })).toBeInTheDocument();
  });

  it('Path B mode hides Path A catalog picker', () => {
    render(<PathModeHarness initialMode="pathB" />);

    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
    expect(screen.queryByText(/Path A — select approved brand/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('brand-select')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Or use Path B/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Switch to Path A/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cancel setup/i })).toBeInTheDocument();
  });

  it('selecting Path B from chooser hides Path A and keeps Path B only', () => {
    const onModeChange = vi.fn();
    render(<PathModeHarness onModeChange={onModeChange} />);

    fireEvent.click(screen.getByRole('button', { name: /Or use Path B — request a new brand/i }));

    expect(onModeChange).toHaveBeenCalledWith('pathB');
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
    expect(screen.queryByTestId('brand-select')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Or use Path B/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Path A — select approved brand/i)).not.toBeInTheDocument();
  });

  it('Cancel setup from Path B returns to chooser with both paths', () => {
    render(<PathModeHarness initialMode="pathB" />);

    fireEvent.click(screen.getByRole('button', { name: /Cancel setup/i }));

    expect(screen.getByText(/Path A — select approved brand/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Or use Path B — request a new brand/i })).toBeInTheDocument();
  });
});
