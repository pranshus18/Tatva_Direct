import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import { useVaultBalance } from '../hooks/useVaultBalance';
import VaultModal from './VaultModal';
import '../styles/vault-balance-pill.css';
import '../styles/vault-modal.css';

export default function VaultBalancePill({ user }) {
  const [open, setOpen] = useState(false);
  const { visible, loading, formattedBalance, linked, refresh } = useVaultBalance(user);

  if (!visible) return null;

  const amountLabel = loading
    ? '…'
    : formattedBalance !== null
      ? `₹${formattedBalance}`
      : linked
        ? '₹0'
        : '—';

  const amountClass = loading
    ? 'vault-balance-pill__amount vault-balance-pill__amount--loading'
    : formattedBalance === null && !linked
      ? 'vault-balance-pill__amount vault-balance-pill__amount--muted'
      : 'vault-balance-pill__amount';

  return (
    <>
      <button
        type="button"
        className="vault-balance-pill"
        aria-label={`Vault balance ${amountLabel}`}
        title="Open My Vault"
        onClick={() => setOpen(true)}
        disabled={loading && formattedBalance === null}
      >
        <Wallet className="vault-balance-pill__icon" strokeWidth={2.2} />
        <span className="vault-balance-pill__label">Vault</span>
        <span className="vault-balance-pill__amount-wrap">
          <span className={amountClass}>{amountLabel}</span>
        </span>
      </button>

      <VaultModal
        open={open}
        onClose={() => setOpen(false)}
        onUpdated={refresh}
      />
    </>
  );
}
