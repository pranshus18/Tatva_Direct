import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wallet, X } from 'lucide-react';
import VaultAddMoneyPanel from './VaultAddMoneyPanel';
import {
  fetchVaultBalance,
  fetchVaultConfig,
  resolveVaultBalance
} from '../services/vaultService';
import '../styles/vault-modal.css';

const formatInr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

export default function VaultModal({ open, onClose, onUpdated }) {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [balance, setBalance] = useState(0);
  const [holdingAmount, setHoldingAmount] = useState(0);
  const [showHolding, setShowHolding] = useState(false);
  const [amount, setAmount] = useState('');
  const [minTopupInr, setMinTopupInr] = useState(1);
  const [notice, setNotice] = useState('');
  const [noticeType, setNoticeType] = useState('');

  const loadVault = useCallback(async () => {
    setLoading(true);
    setNotice('');
    setNoticeType('');
    try {
      const [balanceData, configData] = await Promise.all([
        fetchVaultBalance(),
        fetchVaultConfig()
      ]);
      setBalance(resolveVaultBalance(balanceData));
      setHoldingAmount(
        Number(
          balanceData.holdingAmount ??
            balanceData.vault?.holdingAmount ??
            balanceData.wallet?.holdingAmount ??
            0
        ) || 0
      );
      setMinTopupInr(Number(configData.config?.minTopupInr || 1));
    } catch (error) {
      setNotice(
        error.code === 'PM_AUTH_REQUIRED' || error.status === 401
          ? 'Sign out and sign in again with phone OTP to link your PM vault.'
          : error.message || 'Could not load vault balance'
      );
      setNoticeType('error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setShowHolding(false);
    setAmount('');
    loadVault();
    return undefined;
  }, [open, loadVault]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleVaultUpdated = async () => {
    setNotice('Vault credited successfully.');
    setNoticeType('success');
    setAmount('');
    await loadVault();
    if (onUpdated) onUpdated();
  };

  const handleVaultError = (message) => {
    setNotice(message || 'Vault top-up failed');
    setNoticeType('error');
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="vault-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="vault-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vault-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vault-modal__header">
          <div className="vault-modal__title-wrap">
            <Wallet className="vault-modal__title-icon" strokeWidth={2.2} />
            <h2 id="vault-modal-title" className="vault-modal__title">
              My Vault
            </h2>
          </div>
          <button type="button" className="vault-modal__close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="vault-modal__body">
          <div className="vault-modal__label">Current balance</div>
          <div className="vault-modal__balance">{loading ? 'Loading…' : formatInr(balance)}</div>
          <p className="vault-modal__subtext">Available to use on Tatva Ops</p>

          <VaultAddMoneyPanel
            variant="modal"
            amount={amount}
            onAmountChange={setAmount}
            minTopupInr={minTopupInr}
            processing={processing}
            onProcessingChange={(value) => {
              setProcessing(value);
              if (value) {
                setNotice('');
                setNoticeType('');
              }
            }}
            disabled={loading}
            onSuccess={handleVaultUpdated}
            onError={handleVaultError}
          />

          <div className="vault-modal__actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="vault-modal__btn-secondary"
              onClick={() => setShowHolding((prev) => !prev)}
              disabled={loading}
            >
              Check Holding Amount
            </button>
          </div>

          {showHolding ? (
            <div className="vault-modal__holding">
              <div className="vault-modal__holding-label">Holding amount</div>
              <div className="vault-modal__holding-value">{formatInr(holdingAmount)}</div>
              <p className="vault-modal__subtext" style={{ marginTop: '0.35rem' }}>
                Funds on hold in your PM vault (orders, escrow, or pending debits).
              </p>
            </div>
          ) : null}

          {notice ? (
            <p className={`vault-modal__notice vault-modal__notice--${noticeType || 'info'}`}>{notice}</p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}
