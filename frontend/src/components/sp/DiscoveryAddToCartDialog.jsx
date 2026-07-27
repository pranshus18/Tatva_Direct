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
import { cn } from '@/lib/utils';

const blankShippingAddress = {
  label: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  country: ''
};

const emptyProjectFieldErrors = {
  projectName: '',
  expectedDispatchDate: ''
};

const todayDateMin = getTodayDateInputValue();

export default function DiscoveryAddToCartDialog({
  open,
  onOpenChange,
  product,
  onAdded
}) {
  const [cartProjects, setCartProjects] = useState([]);
  const [targetProjectId, setTargetProjectId] = useState('__new__');
  const [newProjectName, setNewProjectName] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [projectFieldErrors, setProjectFieldErrors] = useState(emptyProjectFieldErrors);
  const [dialogError, setDialogError] = useState('');
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
      setProjectFieldErrors(emptyProjectFieldErrors);
      setDialogError('');
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
    setDialogError('');
    const token = localStorage.getItem('token');
    if (!token) {
      setDialogError('Please log in again to add items to cart.');
      return;
    }
    const productId = product?.productId || product?.id;
    if (!productId) {
      setDialogError('No product selected for adding to cart.');
      return;
    }
    const isNewProject = targetProjectId === '__new__';
    if (isNewProject) {
      const nextFieldErrors = { ...emptyProjectFieldErrors };
      if (!newProjectName.trim()) {
        nextFieldErrors.projectName = 'Please enter a project name.';
      }
      if (!expectedDeliveryDate) {
        nextFieldErrors.expectedDispatchDate = 'Expected dispatch date is required.';
      } else if (isDateBeforeToday(expectedDeliveryDate)) {
        nextFieldErrors.expectedDispatchDate = 'Expected dispatch date cannot be in the past.';
      }
      setProjectFieldErrors(nextFieldErrors);
      if (nextFieldErrors.projectName || nextFieldErrors.expectedDispatchDate) {
        return;
      }
    } else {
      setProjectFieldErrors(emptyProjectFieldErrors);
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
      setDialogError(e.message || 'Failed to add to cart');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-full max-h-none w-full max-w-none flex-col overflow-hidden p-0">
        <div className="shrink-0 border-b px-6 py-4 pr-12">
          <DialogHeader>
            <DialogTitle>Select project for cart item</DialogTitle>
            <DialogDescription>
              Choose where to store this product in your cart. You can add multiple products under one project.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Project</label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={targetProjectId}
              onChange={(event) => {
                const nextTarget = event.target.value;
                setTargetProjectId(nextTarget);
                setProjectFieldErrors(emptyProjectFieldErrors);
                setDialogError('');
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
                <label className="text-sm font-medium" htmlFor="discovery-new-project-name">
                  Project name
                </label>
                <Input
                  id="discovery-new-project-name"
                  maxLength={120}
                  placeholder="e.g. Site A plumbing"
                  value={newProjectName}
                  aria-invalid={Boolean(projectFieldErrors.projectName)}
                  className={cn(projectFieldErrors.projectName && 'border-destructive')}
                  onChange={(event) => {
                    setNewProjectName(event.target.value);
                    if (projectFieldErrors.projectName) {
                      setProjectFieldErrors((prev) => ({ ...prev, projectName: '' }));
                    }
                  }}
                />
                {projectFieldErrors.projectName ? (
                  <p className="text-xs text-destructive" role="alert">
                    {projectFieldErrors.projectName}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium" htmlFor="discovery-expected-dispatch-date">
                  Expected dispatch date
                </label>
                <Input
                  id="discovery-expected-dispatch-date"
                  type="date"
                  min={todayDateMin}
                  value={expectedDeliveryDate}
                  aria-invalid={Boolean(projectFieldErrors.expectedDispatchDate)}
                  aria-describedby={
                    projectFieldErrors.expectedDispatchDate
                      ? 'discovery-expected-dispatch-date-error'
                      : undefined
                  }
                  className={cn(projectFieldErrors.expectedDispatchDate && 'border-destructive')}
                  onChange={(event) => {
                    const next = event.target.value;
                    setExpectedDeliveryDate(next);
                    if (next && isDateBeforeToday(next)) {
                      setProjectFieldErrors((prev) => ({
                        ...prev,
                        expectedDispatchDate: 'Expected dispatch date cannot be in the past.'
                      }));
                      return;
                    }
                    if (projectFieldErrors.expectedDispatchDate) {
                      setProjectFieldErrors((prev) => ({ ...prev, expectedDispatchDate: '' }));
                    }
                  }}
                />
                {projectFieldErrors.expectedDispatchDate ? (
                  <p
                    id="discovery-expected-dispatch-date-error"
                    className="text-xs text-destructive"
                    role="alert"
                  >
                    {projectFieldErrors.expectedDispatchDate}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
          {targetProjectId !== '__new__' ? (
            <p className="text-xs text-muted-foreground">
              Expected dispatch date for this project:{' '}
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
                      placeholder="e.g. Pune"
                      value={newShippingAddress.city}
                      onChange={(event) =>
                        setNewShippingAddress((prev) => ({ ...prev, city: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">State</label>
                    <Input
                      placeholder="e.g. Maharashtra"
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
                      placeholder="e.g. 411026"
                      value={newShippingAddress.pincode}
                      onChange={(event) =>
                        setNewShippingAddress((prev) => ({ ...prev, pincode: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Country</label>
                    <Input
                      placeholder="e.g. India"
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
        {dialogError ? (
          <div
            className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {dialogError}
          </div>
        ) : null}
        </div>
        <div className="shrink-0 border-t bg-background px-6 py-4">
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAddToCart} disabled={busy}>
              {busy ? 'Adding…' : 'Add to cart'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
