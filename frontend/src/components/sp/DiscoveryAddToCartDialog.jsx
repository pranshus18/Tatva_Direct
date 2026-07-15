import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { MapPin } from 'lucide-react';
import { getApiUrl } from '../../config/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { refreshServiceProviderCartCount } from '../../utils/spCartBadge';
import {
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../../utils/currentLocationAddress';
import {
  formatShippingAddressLabel,
  normalizeShippingAddressBookEntry
} from '../../utils/shippingAddressLabel';
import { formatDateIST, getTodayDateInputValue, isDateBeforeToday } from '../../utils/dateTime';

const blankShippingAddress = {
  label: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India'
};

const todayDateMin = getTodayDateInputValue();

export default function DiscoveryAddToCartDialog({
  open,
  onOpenChange,
  product,
  onAdded,
  onError
}) {
  const [cartProjects, setCartProjects] = useState([]);
  const [targetProjectId, setTargetProjectId] = useState('__new__');
  const [newProjectName, setNewProjectName] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [shippingAddressBook, setShippingAddressBook] = useState([]);
  const [selectedShippingAddressId, setSelectedShippingAddressId] = useState('');
  const [newShippingAddress, setNewShippingAddress] = useState(blankShippingAddress);
  const [locatingShippingAddress, setLocatingShippingAddress] = useState(false);
  const [busy, setBusy] = useState(false);

  const applyProjectShippingSelection = (projectId, groups, addresses) => {
    const project = groups.find((group) => group.groupId === projectId);
    const projectAddressId = String(project?.shippingAddressId || '').trim();
    if (projectAddressId && addresses.some((entry) => entry.id === projectAddressId)) {
      setSelectedShippingAddressId(projectAddressId);
      setNewShippingAddress(blankShippingAddress);
      return;
    }
    if (addresses.length > 0) {
      setSelectedShippingAddressId(addresses[0].id);
      setNewShippingAddress(blankShippingAddress);
      return;
    }
    setSelectedShippingAddressId('__new__');
  };

  useEffect(() => {
    if (!open || !product) return undefined;

    let cancelled = false;
    const load = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;

      const loadCartProjects = async () => {
        try {
          const response = await fetch(getApiUrl('/api/po/cart'), {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await response.json();
          if (!response.ok || data.status !== 'success') return [];
          const groups = Array.isArray(data?.cart?.draft?.boqGroups) ? data.cart.draft.boqGroups : [];
          return groups
            .filter((group) => String(group?.groupId || '').trim())
            .map((group) => ({
              groupId: String(group.groupId),
              boqName: String(group?.boqName || '').trim() || 'Untitled project',
              requiredDate: String(group?.boqProject?.requiredDate || '').trim().slice(0, 10),
              shippingAddressId: String(group?.boqProject?.shippingAddressId || '').trim()
            }));
        } catch {
          return [];
        }
      };

      const loadProfileShippingAddresses = async () => {
        try {
          const response = await fetch(getApiUrl('/api/profile'), {
            headers: { Authorization: `Bearer ${token}` }
          });
          const data = await response.json();
          if (!response.ok || !data?.profile) return [];
          return Array.isArray(data.profile.shippingAddresses)
            ? data.profile.shippingAddresses
                .map((entry) => normalizeShippingAddressBookEntry(entry))
                .filter((entry) => entry.id)
            : [];
        } catch {
          return [];
        }
      };

      const [groups, addresses] = await Promise.all([loadCartProjects(), loadProfileShippingAddresses()]);
      if (cancelled) return;
      setCartProjects(groups);
      setShippingAddressBook(addresses);
      const initialProjectId = groups[0]?.groupId || '__new__';
      setTargetProjectId(initialProjectId);
      setNewProjectName(String(product?.name || '').trim());
      setExpectedDeliveryDate('');
      applyProjectShippingSelection(initialProjectId, groups, addresses);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [open, product]);

  const fillShippingFromCurrentLocation = async () => {
    setLocatingShippingAddress(true);
    try {
      const resolved = await resolveAddressFromCurrentLocation();
      setNewShippingAddress((prev) => ({
        ...prev,
        line1: resolved.line1 || prev.line1,
        city: resolved.city || prev.city,
        state: resolved.state || prev.state,
        pincode: resolved.pincode || prev.pincode,
        country: resolved.country || prev.country || 'India',
        label: prev.label || resolved.city || 'Current location'
      }));
      setSelectedShippingAddressId('__new__');
    } catch (error) {
      window.alert(getGeolocationErrorMessage(error));
    } finally {
      setLocatingShippingAddress(false);
    }
  };

  const resolveShippingPayload = async (token) => {
    if (!selectedShippingAddressId) {
      return { shippingAddressId: null, shippingAddress: null };
    }

    if (selectedShippingAddressId === '__new__') {
      const missing = ['line1', 'city', 'state', 'pincode', 'country'].find(
        (field) => !String(newShippingAddress?.[field] || '').trim()
      );
      if (missing) {
        throw new Error('Please complete all shipping address fields or choose a saved address.');
      }
      const saveRes = await fetch(getApiUrl('/api/profile/shipping-addresses'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          label: newShippingAddress.label?.trim() || newShippingAddress.city,
          line1: newShippingAddress.line1.trim(),
          city: newShippingAddress.city.trim(),
          state: newShippingAddress.state.trim(),
          pincode: newShippingAddress.pincode.trim(),
          country: newShippingAddress.country.trim()
        })
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.status !== 'success') {
        throw new Error(saveData.message || 'Failed to save shipping address to profile.');
      }
      const saved = saveData.shippingAddress || {};
      const normalized = normalizeShippingAddressBookEntry(saved);
      setShippingAddressBook((prev) => {
        const exists = prev.some((entry) => entry.id === normalized.id);
        return exists ? prev : [...prev, normalized];
      });
      setSelectedShippingAddressId(normalized.id);
      return {
        shippingAddressId: normalized.id,
        shippingAddress: normalized.address
      };
    }

    const selected = shippingAddressBook.find((entry) => entry.id === selectedShippingAddressId);
    if (!selected) {
      throw new Error('Selected shipping address was not found. Please choose again.');
    }
    return {
      shippingAddressId: selected.id,
      shippingAddress: selected.address
    };
  };

  const confirmAddToCart = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      onError?.('Please log in again to add items to cart.');
      return;
    }
    const productId = product?.productId || product?.id;
    if (!productId) {
      onError?.('No product selected for adding to cart.');
      return;
    }
    const isNewProject = targetProjectId === '__new__';
    if (isNewProject && !newProjectName.trim()) {
      onError?.('Please enter a project name for the new project.');
      return;
    }
    if (isNewProject && !expectedDeliveryDate) {
      onError?.('Please select expected delivery date for the new project.');
      return;
    }
    if (isNewProject && isDateBeforeToday(expectedDeliveryDate)) {
      onError?.('Expected delivery date cannot be in the past.');
      return;
    }

    setBusy(true);
    try {
      const shippingPayload = await resolveShippingPayload(token);
      const payload = {
        productId: String(productId),
        quantity: 1
      };
      if (product?.variantKey) {
        payload.variantKey = String(product.variantKey);
      }
      if (isNewProject) {
        payload.projectName = newProjectName.trim();
        payload.expectedDeliveryDate = expectedDeliveryDate;
      } else {
        payload.groupId = targetProjectId;
      }
      if (shippingPayload.shippingAddressId) {
        payload.shippingAddressId = shippingPayload.shippingAddressId;
        payload.shippingAddress = shippingPayload.shippingAddress;
      }
      const saveRes = await fetch(getApiUrl('/api/po/cart/discovery-item'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.status !== 'success') {
        throw new Error(saveData.message || 'Failed to save cart');
      }
      onOpenChange(false);
      await refreshServiceProviderCartCount({ immediate: true });
      window.dispatchEvent(new Event('sp-workflow-updated'));
      toast.success('Added to cart');
      onAdded?.(String(productId));
    } catch (e) {
      onError?.(e.message || 'Failed to add to cart');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-full max-h-none w-full max-w-none flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Select project for cart item</DialogTitle>
          <DialogDescription>
            Choose where to store this product in your cart. You can add multiple products under one project.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Project</label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={targetProjectId}
              onChange={(event) => {
                const nextTarget = event.target.value;
                setTargetProjectId(nextTarget);
                if (nextTarget !== '__new__') {
                  setExpectedDeliveryDate('');
                  applyProjectShippingSelection(nextTarget, cartProjects, shippingAddressBook);
                }
              }}
            >
              {cartProjects.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.boqName}
                </option>
              ))}
              <option value="__new__">+ Create new project</option>
            </select>
          </div>
          {targetProjectId === '__new__' ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Project name</label>
                <Input
                  maxLength={120}
                  placeholder="e.g. Site A plumbing"
                  value={newProjectName}
                  onChange={(event) => setNewProjectName(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Expected delivery date</label>
                <Input
                  type="date"
                  min={todayDateMin}
                  value={expectedDeliveryDate}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (next && isDateBeforeToday(next)) return;
                    setExpectedDeliveryDate(next);
                  }}
                />
              </div>
            </div>
          ) : null}
          {targetProjectId !== '__new__' ? (
            <p className="text-xs text-muted-foreground">
              Expected delivery date for this project:{' '}
              {(() => {
                const requiredDate = cartProjects.find((group) => group.groupId === targetProjectId)?.requiredDate;
                return requiredDate ? formatDateIST(requiredDate, '—') : 'Not set';
              })()}
            </p>
          ) : null}

          <div className="pd-modal-divider" />

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Shipping address</label>
              <p className="text-xs text-muted-foreground mt-1">
                Optional. Saved to your profile when you add a new address.
              </p>
            </div>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={selectedShippingAddressId}
              onChange={(event) => {
                const next = event.target.value;
                setSelectedShippingAddressId(next);
                if (next !== '__new__') {
                  setNewShippingAddress(blankShippingAddress);
                }
              }}
            >
              <option value="">No shipping address</option>
              {shippingAddressBook.map((entry, index) => (
                <option key={entry.id} value={entry.id}>
                  {entry.displayName || formatShippingAddressLabel(entry, index)}
                </option>
              ))}
              <option value="__new__">+ Add new address</option>
            </select>

            {selectedShippingAddressId === '__new__' ? (
              <div className="pd-modal-address-form space-y-3">
                <div className="checkout-address-location-row">
                  <button
                    type="button"
                    className="checkout-location-btn"
                    onClick={fillShippingFromCurrentLocation}
                    disabled={locatingShippingAddress}
                  >
                    <MapPin size={15} aria-hidden />
                    {locatingShippingAddress ? 'Detecting location…' : 'Use my current location'}
                  </button>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Address label</label>
                  <Input
                    maxLength={120}
                    placeholder="e.g. Site A, Warehouse"
                    value={newShippingAddress.label}
                    onChange={(event) =>
                      setNewShippingAddress((prev) => ({ ...prev, label: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Street address</label>
                  <Input
                    placeholder="Building / street / area"
                    value={newShippingAddress.line1}
                    onChange={(event) =>
                      setNewShippingAddress((prev) => ({ ...prev, line1: event.target.value }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">City</label>
                    <Input
                      value={newShippingAddress.city}
                      onChange={(event) =>
                        setNewShippingAddress((prev) => ({ ...prev, city: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">State</label>
                    <Input
                      value={newShippingAddress.state}
                      onChange={(event) =>
                        setNewShippingAddress((prev) => ({ ...prev, state: event.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">PIN code</label>
                    <Input
                      value={newShippingAddress.pincode}
                      onChange={(event) =>
                        setNewShippingAddress((prev) => ({ ...prev, pincode: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Country</label>
                    <Input
                      value={newShippingAddress.country}
                      onChange={(event) =>
                        setNewShippingAddress((prev) => ({ ...prev, country: event.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirmAddToCart} disabled={busy}>
            {busy ? 'Adding…' : 'Add to cart'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
