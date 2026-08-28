import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SupplierBillingAddressSection } from './Profile';

vi.mock('../services/pmGstService', () => ({
  verifyPmGst: vi.fn()
}));

vi.mock('../services/pmAuthService', () => ({
  restorePmVaultSession: vi.fn()
}));

describe('SupplierBillingAddressSection', () => {
  it('renders supplier billing fields without gstAddressLoading crashing', () => {
    const profile = {
      gstin: '22AAAAA0000A1Z5',
      address: {
        line1: 'Plot 1',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411026',
        country: 'India'
      }
    };

    render(
      <SupplierBillingAddressSection
        profile={profile}
        setProfile={() => {}}
        editing={false}
        setEditing={() => {}}
      />
    );

    expect(screen.getByText('Billing / Registered Company Address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch address from GST' })).toBeEnabled();
    expect(screen.getByDisplayValue('Plot 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pune')).toBeInTheDocument();
  });
});
