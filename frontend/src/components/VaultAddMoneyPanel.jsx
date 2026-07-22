import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { addVaultOfflineMoney } from '../services/vaultService';
import { startVaultTopup } from '../utils/vaultTopup';

const formatInr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;

const OFFLINE_METHODS = {
  cash_on_hand: {
    label: 'Cash on hand',
    referenceLabel: 'Receipt number',
    referencePlaceholder: 'e.g. RCP-00033',
    defaultDetails: 'Cash collected at office',
    submitLabel: 'Record cash on hand',
    modalSubmitLabel: '+ Add cash on hand'
  },
  cheque: {
    label: 'Cheque',
    referenceLabel: 'Cheque number',
    referencePlaceholder: 'e.g. CHQ123456',
    defaultDetails: 'Cheque deposit',
    submitLabel: 'Record cheque deposit',
    modalSubmitLabel: '+ Add cheque deposit'
  },
  bank_to_bank: {
    label: 'Bank to bank',
    referenceLabel: 'UTR number',
    referencePlaceholder: 'e.g. UTR987654321',
    defaultDetails: 'NEFT transfer',
    submitLabel: 'Record bank transfer',
    modalSubmitLabel: '+ Add bank transfer'
  }
};

export default function VaultAddMoneyPanel({
  amount,
  onAmountChange,
  minTopupInr = 100,
  processing,
  onProcessingChange,
  disabled = false,
  onSuccess,
  onError,
  showPresets = false,
  variant = 'page'
}) {
  const [paymentMode, setPaymentMode] = useState('online');
  const [offlineMethod, setOfflineMethod] = useState('cash_on_hand');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [details, setDetails] = useState('');
  const [documents, setDocuments] = useState([]);
  const fileInputRef = useRef(null);

  const isModal = variant === 'modal';
  const offlineConfig = OFFLINE_METHODS[offlineMethod];
  const inputClass = isModal
    ? 'vault-modal__input'
    : 'h-10 w-full rounded-md border px-3 text-sm';
  const fieldWrapClass = isModal ? 'vault-modal__field' : 'space-y-1';
  const labelClass = isModal
    ? 'vault-modal__field-label'
    : 'text-xs font-medium text-slate-600';

  const resetOfflineFields = () => {
    setReferenceNumber('');
    setDetails('');
    setDocuments([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = (event) => {
    setDocuments(Array.from(event.target.files || []));
  };

  const handleOnlineTopup = async () => {
    if (processing) return;
    onProcessingChange(true);
    try {
      await startVaultTopup({
        amount,
        minTopupInr,
        onSuccess: async () => {
          onAmountChange('');
          if (onSuccess) await onSuccess();
        },
        onError: (error) => {
          if (onError) onError(error.message || 'Vault top-up failed');
        },
        onDismiss: () => onProcessingChange(false)
      });
    } catch (error) {
      if (error.message !== 'Payment cancelled' && onError) {
        onError(error.message || 'Could not start vault top-up');
      }
    } finally {
      onProcessingChange(false);
    }
  };

  const handleOfflineTopup = async () => {
    if (processing) return;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      if (onError) onError('Enter a valid amount');
      return;
    }
    if (numericAmount < minTopupInr) {
      if (onError) onError(`Minimum vault credit is INR ${minTopupInr}`);
      return;
    }
    if (!String(referenceNumber || '').trim()) {
      if (onError) onError(`${offlineConfig.referenceLabel} is required`);
      return;
    }

    onProcessingChange(true);
    try {
      const payload = {
        amount: numericAmount,
        subPaymentMethod: offlineMethod,
        details: details.trim() || offlineConfig.defaultDetails,
        documents
      };
      if (offlineMethod === 'cash_on_hand') {
        payload.receiptNumber = referenceNumber.trim();
      } else if (offlineMethod === 'cheque') {
        payload.chequeNumber = referenceNumber.trim();
      } else {
        payload.utrNumber = referenceNumber.trim();
      }

      await addVaultOfflineMoney(payload);
      onAmountChange('');
      resetOfflineFields();
      if (onSuccess) await onSuccess();
    } catch (error) {
      if (onError) {
        onError(
          error.code === 'PM_AUTH_REQUIRED'
            ? 'Sign out and sign in again with phone OTP to link your PM vault.'
            : error.message || 'Offline vault payment failed'
        );
      }
    } finally {
      onProcessingChange(false);
    }
  };

  const handleSubmit = () => {
    if (paymentMode === 'offline') {
      handleOfflineTopup();
    } else {
      handleOnlineTopup();
    }
  };

  const presetAmounts = [minTopupInr, 500, 1000, 2000, 5000].filter(
    (value, index, list) => list.indexOf(value) === index
  );

  const tabClass = (active) =>
    isModal
      ? `vault-modal__mode-tab${active ? ' vault-modal__mode-tab--active' : ''}`
      : `rounded-md border px-3 py-1.5 text-xs font-medium ${
          active
            ? 'border-slate-900 bg-slate-900 text-white'
            : 'border-slate-200 text-slate-700 hover:bg-slate-50'
        }`;

  const offlineDescription =
    paymentMode === 'offline'
      ? `Record ${offlineConfig.label.toLowerCase()} payment — credits PM vault via add-money API.`
      : '';

  return (
    <div className={isModal ? 'vault-modal__add-money' : 'space-y-3'}>
      <div className={isModal ? 'vault-modal__mode-tabs' : 'flex flex-wrap gap-2'}>
        <button
          type="button"
          className={tabClass(paymentMode === 'online')}
          onClick={() => setPaymentMode('online')}
          disabled={processing || disabled}
        >
          Online (Razorpay)
        </button>
        <button
          type="button"
          className={tabClass(paymentMode === 'offline')}
          onClick={() => setPaymentMode('offline')}
          disabled={processing || disabled}
        >
          Offline
        </button>
      </div>

      {paymentMode === 'offline' ? (
        <div className={isModal ? 'vault-modal__mode-tabs vault-modal__mode-tabs--sub' : 'flex flex-wrap gap-2'}>
          {Object.entries(OFFLINE_METHODS).map(([key, config]) => (
            <button
              key={key}
              type="button"
              className={tabClass(offlineMethod === key)}
              onClick={() => {
                setOfflineMethod(key);
                setReferenceNumber('');
                setDetails('');
              }}
              disabled={processing || disabled}
            >
              {config.label}
            </button>
          ))}
        </div>
      ) : null}

      {showPresets ? (
        <div className="flex flex-wrap gap-2">
          {presetAmounts.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => onAmountChange(String(preset))}
              className="rounded-md border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
              disabled={processing || disabled}
            >
              +{formatInr(preset)}
            </button>
          ))}
        </div>
      ) : null}

      <p className={isModal ? 'vault-modal__subtext' : 'text-xs text-slate-600'}>
        {paymentMode === 'online'
          ? 'Enter amount in ₹ (Indian rupees). 1 ₹ = 100 paise — paise is only used for Razorpay checkout.'
          : offlineDescription}
      </p>

      {isModal ? (
        <div className="vault-modal__input-wrap">
          <span className="vault-modal__input-prefix">₹</span>
          <input
            type="number"
            min={minTopupInr}
            step={1}
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            placeholder="Enter amount in ₹"
            className={inputClass}
            disabled={processing || disabled}
          />
        </div>
      ) : (
        <input
          type="number"
          min={minTopupInr}
          step={1}
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          className={inputClass}
          placeholder="Amount in ₹"
          disabled={processing || disabled}
        />
      )}

      {paymentMode === 'offline' ? (
        <div className={isModal ? 'vault-modal__offline-fields' : 'grid gap-3 md:grid-cols-2'}>
          <div className={fieldWrapClass}>
            <label className={labelClass} htmlFor="vault-offline-reference">
              {offlineConfig.referenceLabel} *
            </label>
            <input
              id="vault-offline-reference"
              type="text"
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
              placeholder={offlineConfig.referencePlaceholder}
              className={isModal ? 'vault-modal__text-input' : inputClass}
              disabled={processing || disabled}
            />
          </div>
          <div className={fieldWrapClass}>
            <label className={labelClass} htmlFor="vault-offline-details">
              Details
            </label>
            <input
              id="vault-offline-details"
              type="text"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder={offlineConfig.defaultDetails}
              className={isModal ? 'vault-modal__text-input' : inputClass}
              disabled={processing || disabled}
            />
          </div>
          <div className={isModal ? fieldWrapClass : 'md:col-span-2 space-y-1'}>
            <label className={labelClass} htmlFor="vault-offline-documents">
              Supporting documents (optional)
            </label>
            <input
              id="vault-offline-documents"
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={handleFileChange}
              className={isModal ? 'vault-modal__file-input' : 'block w-full text-xs text-slate-600'}
              disabled={processing || disabled}
            />
            {documents.length ? (
              <p className={isModal ? 'vault-modal__subtext' : 'text-xs text-slate-500'}>
                {documents.length} file{documents.length === 1 ? '' : 's'} selected
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {isModal ? (
        <div className="vault-modal__actions">
          <button
            type="button"
            className="vault-modal__btn-primary"
            onClick={handleSubmit}
            disabled={processing || disabled}
          >
            {processing
              ? 'Processing…'
              : paymentMode === 'offline'
                ? offlineConfig.modalSubmitLabel
                : '+ Add Money'}
          </button>
        </div>
      ) : (
        <Button onClick={handleSubmit} disabled={processing || disabled}>
          {processing
            ? 'Processing…'
            : paymentMode === 'offline'
              ? offlineConfig.submitLabel
              : 'Credit vault'}
        </Button>
      )}
    </div>
  );
}
