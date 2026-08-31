import React, { useEffect, useState } from 'react';
import { Briefcase, Check, Home, MapPin, Navigation, X } from 'lucide-react';
import { authFetch } from '../config/api';
import { applyPmVaultCredentials } from '../utils/pmAuthSession';
import {
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../utils/currentLocationAddress';
import {
  applyPincodeLookupToForm,
  buildPmShippingAddressRequest,
  emptyPmShippingAddressForm,
  mapResolvedLocationToPmForm,
  PM_ADDRESS_SUBTYPE_OPTIONS,
  validatePmShippingAddressForm
} from '../utils/pmShippingAddress';
import './AddShippingAddressModal.css';

const SUBTYPE_ICONS = {
  HOME: Home,
  WORK: Briefcase,
  OTHER: MapPin
};

export default function AddShippingAddressModal({ open, onClose, onSaved }) {
  const [form, setForm] = useState(emptyPmShippingAddressForm);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [lookupStatus, setLookupStatus] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setForm(emptyPmShippingAddressForm());
    setErrors({});
    setSaving(false);
    setLocating(false);
    setLookupStatus('');
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const zip = String(form.zip || '').trim();
    if (!/^\d{6}$/.test(zip)) {
      setLookupStatus('');
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLookupStatus('Filling address from pincode…');
      try {
        const res = await authFetch(`/api/geo/pincode/${encodeURIComponent(zip)}`, { timeoutMs: 15000 });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || data.status !== 'success' || !data.address) {
          setLookupStatus('Could not auto-fill address for this pincode.');
          return;
        }
        setForm((prev) => applyPincodeLookupToForm(prev, data.address));
        setLookupStatus('');
      } catch {
        if (!cancelled) setLookupStatus('Could not auto-fill address for this pincode.');
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.zip, open]);

  if (!open) return null;

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const fillFromCurrentLocation = async () => {
    setLocating(true);
    try {
      const resolved = await resolveAddressFromCurrentLocation();
      const mapped = mapResolvedLocationToPmForm(resolved);
      setForm((prev) => ({
        ...prev,
        ...mapped,
        building: mapped.building || prev.building,
        buildingName: mapped.buildingName || prev.buildingName
      }));
    } catch (error) {
      alert(getGeolocationErrorMessage(error));
    } finally {
      setLocating(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    const nextErrors = validatePmShippingAddressForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setSaving(true);
    try {
      const payload = buildPmShippingAddressRequest(form);
      const res = await authFetch('/api/profile/shipping-addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeoutMs: 20000
      });
      const data = await res.json().catch(() => ({}));
      if (data.pmVault) applyPmVaultCredentials(data.pmVault);
      if (!res.ok || data.status !== 'success') {
        alert(data.message || 'Failed to save shipping address to the PM platform.');
        return;
      }
      onSaved?.(data);
      onClose?.();
    } catch (error) {
      alert(error?.message || 'Failed to save shipping address. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="add-address-overlay" onClick={onClose} role="presentation">
      <div
        className="add-address-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-address-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="add-address-header">
          <h2 id="add-address-title">Add New Address</h2>
          <button type="button" className="add-address-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <form className="add-address-body" onSubmit={handleSave}>
          <div className="add-address-field">
            <span className="add-address-label">Type</span>
            <div className="add-address-types" role="group" aria-label="Address type">
              {PM_ADDRESS_SUBTYPE_OPTIONS.map((option) => {
                const Icon = SUBTYPE_ICONS[option.id];
                const selected = form.subType === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={`add-address-type${selected ? ' is-selected' : ''}`}
                    onClick={() => updateField('subType', option.id)}
                  >
                    <Icon size={16} aria-hidden />
                    {option.label}
                  </button>
                );
              })}
            </div>
            {form.subType === 'OTHER' ? (
              <input
                className="add-address-input"
                value={form.customSubType}
                onChange={(event) => updateField('customSubType', event.target.value)}
                placeholder="Enter subtype (e.g. Warehouse)"
              />
            ) : null}
            {errors.customSubType ? <p className="add-address-error">{errors.customSubType}</p> : null}
          </div>

          <button
            type="button"
            className="add-address-location"
            onClick={fillFromCurrentLocation}
            disabled={locating}
          >
            <Navigation size={16} aria-hidden />
            {locating ? 'Detecting location…' : 'Current Location'}
          </button>

          <div className="add-address-grid">
            <label className="add-address-field add-address-span-2">
              <span className="add-address-label">
                Building/House No<span className="add-address-required">*</span>
              </span>
              <input
                className="add-address-input"
                value={form.building}
                onChange={(event) => updateField('building', event.target.value)}
                placeholder="e.g., 123"
              />
              {errors.building ? <p className="add-address-error">{errors.building}</p> : null}
            </label>
            <label className="add-address-field add-address-span-2">
              <span className="add-address-label">Building Name</span>
              <input
                className="add-address-input"
                value={form.buildingName}
                onChange={(event) => updateField('buildingName', event.target.value)}
                placeholder="e.g., Sunrise Apartments"
              />
            </label>
            <label className="add-address-field add-address-span-2">
              <span className="add-address-label">Floor</span>
              <input
                className="add-address-input"
                value={form.floor}
                onChange={(event) => updateField('floor', event.target.value)}
                placeholder="e.g., 3rd Floor"
              />
            </label>
            <label className="add-address-field add-address-span-2">
              <span className="add-address-label">Street</span>
              <input
                className="add-address-input"
                value={form.street}
                onChange={(event) => updateField('street', event.target.value)}
                placeholder="Street name"
              />
            </label>
            <label className="add-address-field add-address-span-full">
              <span className="add-address-label">Locality/Area</span>
              <input
                className="add-address-input"
                value={form.locality}
                onChange={(event) => updateField('locality', event.target.value)}
                placeholder="Locality or Area"
              />
            </label>
            <label className="add-address-field add-address-span-third">
              <span className="add-address-label">District</span>
              <input
                className="add-address-input"
                value={form.district}
                onChange={(event) => updateField('district', event.target.value)}
                placeholder="District"
              />
            </label>
            <label className="add-address-field add-address-span-third">
              <span className="add-address-label">
                Zip/Pincode<span className="add-address-required">*</span>
              </span>
              <input
                className="add-address-input"
                value={form.zip}
                onChange={(event) => updateField('zip', event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="6-digit code"
                inputMode="numeric"
              />
              {errors.zip ? <p className="add-address-error">{errors.zip}</p> : null}
            </label>
            <label className="add-address-field add-address-span-third">
              <span className="add-address-label">
                State<span className="add-address-required">*</span>
              </span>
              <input
                className="add-address-input is-autofill"
                value={form.state}
                onChange={(event) => updateField('state', event.target.value)}
                placeholder="Auto filled"
              />
              {errors.state ? <p className="add-address-error">{errors.state}</p> : null}
            </label>
          </div>
          {lookupStatus ? <p className="add-address-hint">{lookupStatus}</p> : null}

          <footer className="add-address-footer">
            <button type="button" className="add-address-cancel" onClick={onClose} disabled={saving}>
              <X size={16} aria-hidden />
              Cancel
            </button>
            <button type="submit" className="add-address-save" disabled={saving}>
              <Check size={16} aria-hidden />
              {saving ? 'Saving…' : 'Save Address'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
