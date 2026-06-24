import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clipboard,
  Loader2,
  Mail,
  MessageCircle,
  Package,
  Pencil,
  RefreshCw,
  Share2,
  ShoppingCart,
  Trash2,
  MapPin
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl } from '../config/api';
import { persistSupplierSelectScopeFromCart } from '../constants/supplierSelectSession';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import SpWorkflowPage from '../components/sp/SpWorkflowPage';
import SpEmptyState from '../components/sp/SpEmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatDateIST } from '../utils/dateTime';
import {
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../utils/currentLocationAddress';
import {
  formatShippingAddressLabel,
  formatShippingAddressPreview,
  normalizeShippingAddressBookEntry
} from '../utils/shippingAddressLabel';
import { clearVendorRankCache } from '../utils/vendorRankCache';

const blankShippingAddress = {
  label: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India'
};

function isShippingAddressComplete(address = {}) {
  return ['line1', 'city', 'state', 'pincode', 'country'].every((field) =>
    String(address?.[field] || '').trim()
  );
}

const Cart = ({ onLoadCart }) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cart, setCart] = useState(null);
  const [busyByItemId, setBusyByItemId] = useState({});
  const [clearingCart, setClearingCart] = useState(false);
  const [sharingCart, setSharingCart] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copyingShareLink, setCopyingShareLink] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState('');
  const [draftGroupNames, setDraftGroupNames] = useState({});
  const [draftGroupDates, setDraftGroupDates] = useState({});
  const [draftGroupShipping, setDraftGroupShipping] = useState({});
  const [shippingAddressBook, setShippingAddressBook] = useState([]);
  const [locatingShippingByGroup, setLocatingShippingByGroup] = useState({});
  const [busyByGroupId, setBusyByGroupId] = useState({});

  const token = localStorage.getItem('token');
  const cartRef = useRef(null);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  const getGroups = (draft) => {
    if (!draft || typeof draft !== 'object') return [];
    if (Array.isArray(draft.boqGroups)) return draft.boqGroups;
    if (Array.isArray(draft.items) && draft.items.length) {
      return [
        {
          groupId: 'legacy-cart',
          boqName: 'Cart Items',
          items: draft.items
        }
      ];
    }
    return [];
  };

  const mergeItemQuantityIntoDraft = (draft, itemId, nextQuantity) => {
    if (!draft || typeof draft !== 'object') return draft;
    const id = String(itemId || '');
    const qty = Math.floor(Number(nextQuantity)) || 1;
    if (Array.isArray(draft.boqGroups) && draft.boqGroups.length > 0) {
      const nextBoqGroups = draft.boqGroups.map((g) => ({
        ...g,
        items: Array.isArray(g.items)
          ? g.items.map((it) => (String(it?.id) === id ? { ...it, quantity: qty } : it))
          : []
      }));
      // Keep flat `items` in lockstep with groups (same as server normalizePoCartDraft).
      const nextFlat = nextBoqGroups.flatMap((g) => (Array.isArray(g.items) ? g.items : []));
      return { ...draft, boqGroups: nextBoqGroups, items: nextFlat };
    }
    const nextFlat = Array.isArray(draft.items)
      ? draft.items.map((it) => (String(it?.id) === id ? { ...it, quantity: qty } : it))
      : draft.items;
    return { ...draft, items: nextFlat };
  };

  const mergeRemoveItemFromDraft = (draft, itemId) => {
    if (!draft || typeof draft !== 'object') return draft;
    const id = String(itemId || '');
    if (Array.isArray(draft.boqGroups) && draft.boqGroups.length > 0) {
      const nextBoqGroups = draft.boqGroups
        .map((g) => ({
          ...g,
          items: Array.isArray(g.items) ? g.items.filter((it) => String(it?.id) !== id) : []
        }))
        .filter((g) => Array.isArray(g.items) && g.items.length > 0);
      const nextFlat = nextBoqGroups.flatMap((g) => (Array.isArray(g.items) ? g.items : []));
      return { ...draft, boqGroups: nextBoqGroups, items: nextFlat };
    }
    const nextFlat = Array.isArray(draft.items)
      ? draft.items.filter((it) => String(it?.id) !== id)
      : draft.items;
    return { ...draft, items: nextFlat };
  };

  const getGroupRequiredDate = (group) => {
    if (!group || typeof group !== 'object') return '';
    const fromProject = String(group?.boqProject?.requiredDate || '').trim();
    if (fromProject) return fromProject.slice(0, 10);
    const fromGroup = String(group?.requiredDate || '').trim();
    if (fromGroup) return fromGroup.slice(0, 10);
    return '';
  };

  const getGroupShippingPreview = (group) => {
    const project = group?.boqProject && typeof group.boqProject === 'object' ? group.boqProject : {};
    if (project.location) return String(project.location);
    if (project.shippingAddress) return formatShippingAddressPreview(project.shippingAddress);
    return '';
  };

  const buildGroupShippingDraft = (group, addresses = shippingAddressBook) => {
    const project = group?.boqProject && typeof group.boqProject === 'object' ? group.boqProject : {};
    const savedId = String(project.shippingAddressId || '').trim();
    if (savedId && addresses.some((entry) => entry.id === savedId)) {
      return { selectedShippingAddressId: savedId, newShippingAddress: { ...blankShippingAddress } };
    }
    if (project.shippingAddress && typeof project.shippingAddress === 'object') {
      const inline = project.shippingAddress;
      const match = addresses.find((entry) => {
        const addr = entry.address || {};
        return (
          String(addr.line1 || '') === String(inline.line1 || '') &&
          String(addr.city || '') === String(inline.city || '') &&
          String(addr.pincode || '') === String(inline.pincode || '')
        );
      });
      if (match) {
        return { selectedShippingAddressId: match.id, newShippingAddress: { ...blankShippingAddress } };
      }
      return {
        selectedShippingAddressId: '__new__',
        newShippingAddress: {
          label: '',
          line1: String(inline.line1 || ''),
          city: String(inline.city || ''),
          state: String(inline.state || ''),
          pincode: String(inline.pincode || ''),
          country: String(inline.country || 'India')
        }
      };
    }
    if (addresses.length > 0) {
      return { selectedShippingAddressId: addresses[0].id, newShippingAddress: { ...blankShippingAddress } };
    }
    return { selectedShippingAddressId: '', newShippingAddress: { ...blankShippingAddress } };
  };

  const loadProfileShippingAddresses = async () => {
    if (!token) return [];
    try {
      const response = await fetch(getApiUrl('/api/profile'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok || !data?.profile) return [];
      const entries = Array.isArray(data.profile.shippingAddresses)
        ? data.profile.shippingAddresses
            .map((entry) => normalizeShippingAddressBookEntry(entry))
            .filter((entry) => entry.id)
        : [];
      setShippingAddressBook(entries);
      return entries;
    } catch {
      return [];
    }
  };

  const mergeGroupDetailsIntoDraft = (draft, groupId, nextName, nextDate, shippingMeta) => {
    if (!draft || typeof draft !== 'object') return draft;
    const normalizedGroupId = String(groupId || '').trim();
    if (!normalizedGroupId) return draft;
    const groups = Array.isArray(draft.boqGroups) ? [...draft.boqGroups] : [];
    const nextGroups = groups.map((group) =>
      String(group?.groupId || '') === normalizedGroupId
        ? (() => {
            const nextProjectMeta = {
              ...(group?.boqProject && typeof group.boqProject === 'object' ? group.boqProject : {})
            };
            if (nextDate) nextProjectMeta.requiredDate = nextDate;
            else delete nextProjectMeta.requiredDate;
            if (shippingMeta !== undefined) {
              if (!shippingMeta || shippingMeta.clear) {
                delete nextProjectMeta.shippingAddress;
                delete nextProjectMeta.shippingAddressId;
                delete nextProjectMeta.location;
                delete nextProjectMeta.siteGeo;
              } else {
                if (shippingMeta.shippingAddress) {
                  nextProjectMeta.shippingAddress = shippingMeta.shippingAddress;
                }
                if (shippingMeta.shippingAddressId) {
                  nextProjectMeta.shippingAddressId = shippingMeta.shippingAddressId;
                }
                if (shippingMeta.location) nextProjectMeta.location = shippingMeta.location;
                if (shippingMeta.siteGeo) nextProjectMeta.siteGeo = shippingMeta.siteGeo;
              }
            }
            return {
              ...group,
              boqName: nextName,
              boqProject: nextProjectMeta
            };
          })()
        : group
    );
    return { ...draft, boqGroups: nextGroups };
  };

  /**
   * @param {{ silent?: boolean, syncWorkflow?: boolean }} [options]
   * silent: no full-page loading spinner. When syncWorkflow is true (or silent is false), push draft to parent via onLoadCart.
   */
  const loadCart = async (options = {}) => {
    const silent = options.silent === true;
    const syncWorkflow = options.syncWorkflow === true || !silent;
    if (!token) {
      setError('Please log in again to view cart.');
      setLoading(false);
      return;
    }
    if (!silent) {
      setLoading(true);
    }
    setError('');
    try {
      const response = await fetch(getApiUrl('/api/po/cart'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to load cart');
      }
      setCart(data.cart || null);
      if (syncWorkflow && data.cart?.draft && typeof onLoadCart === 'function') {
        onLoadCart(data.cart.draft);
      }
    } catch (e) {
      setError(e.message || 'Failed to load cart');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadCart();
    loadProfileShippingAddresses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onVoiceCart = () => {
      loadCart({ silent: true, syncWorkflow: true });
    };
    window.addEventListener('voice-cart-updated', onVoiceCart);
    return () => window.removeEventListener('voice-cart-updated', onVoiceCart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => getGroups(cart?.draft || {}), [cart]);
  const allItems = useMemo(
    () => groups.flatMap((group) => (Array.isArray(group?.items) ? group.items : [])),
    [groups]
  );

  const updateQuantity = async (itemId, nextQuantity) => {
    if (!token) {
      setError('Please log in again to update quantity.');
      return;
    }
    const parsed = Number(nextQuantity);
    if (!Number.isFinite(parsed) || parsed < 1) return;
    const normalizedItemId = String(itemId || '').trim();
    if (!normalizedItemId) return;

    setBusyByItemId((prev) => ({ ...prev, [normalizedItemId]: true }));
    setError('');
    try {
      const response = await fetch(
        getApiUrl(`/api/po/cart/items/${encodeURIComponent(normalizedItemId)}/quantity`),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ quantity: Math.floor(parsed) })
        }
      );
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update quantity');
      }
      // Avoid full reload + loading flash: merge server item (PATCH returns updated row).
      if (data.item) {
        const id = String(data.item.id ?? normalizedItemId);
        const qty = Math.floor(Number(data.item.quantity)) || parsed;
        const prev = cartRef.current;
        if (prev?.draft) {
          const nextDraft = mergeItemQuantityIntoDraft(prev.draft, id, qty);
          setCart({ ...prev, draft: nextDraft });
          if (typeof onLoadCart === 'function') {
            onLoadCart(nextDraft);
          }
        } else {
          await loadCart({ silent: true, syncWorkflow: true });
        }
      } else {
        await loadCart({ silent: true, syncWorkflow: true });
      }
    } catch (e) {
      setError(e.message || 'Failed to update quantity');
    } finally {
      setBusyByItemId((prev) => {
        const { [normalizedItemId]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const resolveGroupShippingPayload = async (groupId) => {
    const draft = draftGroupShipping[groupId] || buildGroupShippingDraft({});
    const selectedId = String(draft.selectedShippingAddressId ?? '');

    if (!selectedId) {
      return { clear: true, shippingAddressId: '' };
    }

    if (selectedId === '__new__') {
      const missing = ['line1', 'city', 'state', 'pincode', 'country'].find(
        (field) => !String(draft.newShippingAddress?.[field] || '').trim()
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
          label: draft.newShippingAddress.label?.trim() || draft.newShippingAddress.city,
          line1: draft.newShippingAddress.line1.trim(),
          city: draft.newShippingAddress.city.trim(),
          state: draft.newShippingAddress.state.trim(),
          pincode: draft.newShippingAddress.pincode.trim(),
          country: draft.newShippingAddress.country.trim()
        })
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.status !== 'success') {
        throw new Error(saveData.message || 'Failed to save shipping address to profile.');
      }
      const normalized = normalizeShippingAddressBookEntry(saveData.shippingAddress || {});
      if (!normalized.id) {
        throw new Error('Saved address did not return an id.');
      }
      setShippingAddressBook((prev) => {
        const without = prev.filter((entry) => entry.id !== normalized.id);
        return [...without, normalized];
      });
      return {
        shippingAddressId: normalized.id,
        shippingAddress: normalized.address
      };
    }

    const selected = shippingAddressBook.find((entry) => entry.id === selectedId);
    if (!selected) {
      throw new Error('Selected shipping address was not found. Please choose again.');
    }
    return {
      shippingAddressId: selected.id,
      shippingAddress: selected.address
    };
  };

  const updateProjectDetails = async (groupId, nextNameInput, nextDateInput) => {
    if (!token) {
      setError('Please log in again to update project details.');
      return;
    }
    const normalizedGroupId = String(groupId || '').trim();
    const nextName = String(nextNameInput || '').trim();
    const nextDate = String(nextDateInput || '').trim();
    if (!normalizedGroupId) return;
    if (!nextName) {
      setError('Project name cannot be empty.');
      return;
    }

    setBusyByGroupId((prev) => ({ ...prev, [normalizedGroupId]: true }));
    setError('');
    try {
      const shippingPayload = await resolveGroupShippingPayload(normalizedGroupId);
      const response = await fetch(
        getApiUrl(`/api/po/cart/groups/${encodeURIComponent(normalizedGroupId)}/name`),
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            boqName: nextName,
            expectedDeliveryDate: nextDate,
            shippingAddressId: shippingPayload.shippingAddressId ?? '',
            ...(shippingPayload.shippingAddress
              ? { shippingAddress: shippingPayload.shippingAddress }
              : {})
          })
        }
      );
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update project details');
      }

      const appliedShipping = data.group?.shippingAddress
        ? {
            shippingAddressId: data.group.shippingAddressId || null,
            shippingAddress: data.group.shippingAddress,
            location: data.group.location || null,
            siteGeo: data.group.siteGeo || null
          }
        : shippingPayload.clear
          ? { clear: true }
          : shippingPayload;

      const prev = cartRef.current;
      if (prev?.draft) {
        const nextDraft = mergeGroupDetailsIntoDraft(
          prev.draft,
          normalizedGroupId,
          nextName,
          nextDate,
          appliedShipping
        );
        setCart({ ...prev, draft: nextDraft });
        if (typeof onLoadCart === 'function') {
          onLoadCart(nextDraft);
        }
      } else {
        await loadCart({ silent: true, syncWorkflow: true });
      }
      clearVendorRankCache();
      setEditingGroupId('');
      setDraftGroupNames((prev) => ({ ...prev, [normalizedGroupId]: nextName }));
      setDraftGroupDates((prev) => ({ ...prev, [normalizedGroupId]: nextDate }));
    } catch (e) {
      setError(e.message || 'Failed to update project details');
    } finally {
      setBusyByGroupId((prev) => {
        const { [normalizedGroupId]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const removeItem = async (itemId) => {
    if (!token) {
      setError('Please log in again to remove cart item.');
      return;
    }
    const normalizedItemId = String(itemId || '').trim();
    if (!normalizedItemId) return;

    setBusyByItemId((prev) => ({ ...prev, [normalizedItemId]: true }));
    setError('');
    try {
      const response = await fetch(
        getApiUrl(`/api/po/cart/items/${encodeURIComponent(normalizedItemId)}`),
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to remove item');
      }
      const prev = cartRef.current;
      if (prev?.draft) {
        const nextDraft = mergeRemoveItemFromDraft(prev.draft, normalizedItemId);
        setCart({ ...prev, draft: nextDraft });
        if (typeof onLoadCart === 'function') {
          onLoadCart(nextDraft);
        }
      } else {
        await loadCart({ silent: true, syncWorkflow: true });
      }
    } catch (e) {
      setError(e.message || 'Failed to remove item');
    } finally {
      setBusyByItemId((prev) => {
        const { [normalizedItemId]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleClearCart = async () => {
    if (!token) {
      setError('Please log in again to clear cart.');
      return;
    }
    const confirmed = window.confirm('Clear all cart items?');
    if (!confirmed) return;

    setClearingCart(true);
    setError('');
    try {
      const response = await fetch(getApiUrl('/api/po/cart'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to clear cart');
      }
      setCart(null);
      if (typeof onLoadCart === 'function') onLoadCart({});
    } catch (e) {
      setError(e.message || 'Failed to clear cart');
    } finally {
      setClearingCart(false);
    }
  };

  const resolveGroupBoqProjectForSupplierSelect = (group) => {
    const groupId = String(group?.groupId || '').trim();
    const saved =
      group?.boqProject && typeof group.boqProject === 'object' ? { ...group.boqProject } : {};
    if (saved.shippingAddress && isShippingAddressComplete(saved.shippingAddress)) {
      return {
        ...saved,
        location: saved.location || formatShippingAddressPreview(saved.shippingAddress)
      };
    }

    const draft = draftGroupShipping[groupId] || buildGroupShippingDraft(group, shippingAddressBook);
    const selectedId = String(draft.selectedShippingAddressId ?? '');

    if (selectedId && selectedId !== '__new__') {
      const entry = shippingAddressBook.find((e) => e.id === selectedId);
      if (entry?.address && isShippingAddressComplete(entry.address)) {
        return {
          ...saved,
          shippingAddressId: entry.id,
          shippingAddress: entry.address,
          location: formatShippingAddressPreview(entry.address)
        };
      }
    }

    if (selectedId === '__new__' && isShippingAddressComplete(draft.newShippingAddress)) {
      const addr = {
        line1: String(draft.newShippingAddress.line1 || '').trim(),
        city: String(draft.newShippingAddress.city || '').trim(),
        state: String(draft.newShippingAddress.state || '').trim(),
        pincode: String(draft.newShippingAddress.pincode || '').trim(),
        country: String(draft.newShippingAddress.country || 'India').trim() || 'India'
      };
      return {
        ...saved,
        shippingAddress: addr,
        location: formatShippingAddressPreview(addr)
      };
    }

    return null;
  };

  const buildDraftFromGroup = (group) => {
    if (!group || typeof group !== 'object') return null;
    const normalizedGroup = {
      groupId: String(group.groupId || `group-${Date.now()}`),
      boqId: group.boqId || null,
      boqName: group.boqName || null,
      boqProject: group.boqProject && typeof group.boqProject === 'object' ? group.boqProject : null,
      items: Array.isArray(group.items) ? group.items : [],
      selectedVendors: group.selectedVendors && typeof group.selectedVendors === 'object' ? group.selectedVendors : {},
      substitutions: Array.isArray(group.substitutions) ? group.substitutions : []
    };
    return {
      selectedVendors: normalizedGroup.selectedVendors,
      substitutions: normalizedGroup.substitutions,
      items: normalizedGroup.items,
      boqGroups: [normalizedGroup],
      boqId: normalizedGroup.boqId,
      boqProject: normalizedGroup.boqProject
    };
  };

  const buildDraftFromAllGroups = (groupList, rootDraft = {}) => {
    const mergedSelectedVendors = {};
    const mergedSubstitutions = [];
    const mergedItems = [];
    const boqGroups = [];
    const substitutionKeys = new Set();

    for (const group of groupList || []) {
      const groupDraft = buildDraftFromGroup(group);
      if (!groupDraft) continue;
      if (Array.isArray(groupDraft.boqGroups)) boqGroups.push(...groupDraft.boqGroups);
      for (const item of groupDraft.items || []) mergedItems.push(item);
      Object.assign(mergedSelectedVendors, groupDraft.selectedVendors || {});
      for (const sub of groupDraft.substitutions || []) {
        const key = `${String(sub?.originalItem || '')}::${String(sub?.suggestedItem || '')}`;
        if (substitutionKeys.has(key)) continue;
        substitutionKeys.add(key);
        mergedSubstitutions.push(sub);
      }
    }

    const firstGroup = Array.isArray(groupList) && groupList.length > 0 ? groupList[0] : null;
    return {
      selectedVendors: mergedSelectedVendors,
      substitutions: mergedSubstitutions,
      items: mergedItems,
      boqGroups,
      boqId: firstGroup?.boqId ?? rootDraft?.boqId ?? null,
      boqProject: firstGroup?.boqProject ?? rootDraft?.boqProject ?? null
    };
  };

  const handleSkipToCreatePo = () => {
    const draft = buildDraftFromAllGroups(groups, cart?.draft || {});
    if (typeof onLoadCart === 'function') onLoadCart(draft);
    navigate('/create-po');
  };

  const buildDraftFromSingleItem = (item, group) => {
    const groupDraft = buildDraftFromGroup(group);
    if (!groupDraft || !item) return null;
    const one = groupDraft.items.find((it) => String(it?.id) === String(item?.id)) || item;
    const g0 = groupDraft.boqGroups?.[0];
    const narrowedGroup = g0
      ? {
          ...g0,
          items: [one],
          selectedVendors: g0.selectedVendors && typeof g0.selectedVendors === 'object' ? { ...g0.selectedVendors } : {}
        }
      : null;
    return {
      ...groupDraft,
      items: [one],
      boqGroups: narrowedGroup ? [narrowedGroup] : groupDraft.boqGroups
    };
  };

  const supplierSelectNavigationState = (draft) => {
    if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) return undefined;
    return {
      supplierSelectItems: draft.items,
      supplierSelectBoqProject: draft.boqProject ?? null,
      supplierSelectBoqId: draft.boqId ?? null,
      fromCartSupplierSelect: true
    };
  };

  const handleContinueToSupplierSelectionForGroup = (group) => {
    const resolvedProject = resolveGroupBoqProjectForSupplierSelect(group);
    if (!resolvedProject?.shippingAddress) {
      setError('Please set a delivery address for this project before selecting suppliers.');
      return;
    }
    const groupWithShipping = {
      ...group,
      boqProject: {
        ...(group?.boqProject && typeof group.boqProject === 'object' ? group.boqProject : {}),
        ...resolvedProject
      }
    };
    const groupDraft = buildDraftFromGroup(groupWithShipping);
    if (groupDraft && typeof onLoadCart === 'function') onLoadCart(groupDraft);
    persistSupplierSelectScopeFromCart(groupDraft.items, groupDraft.boqProject);
    const navState = supplierSelectNavigationState(groupDraft);
    navigate(
      { pathname: '/supplier-select', search: '?from=cart' },
      navState ? { state: navState } : {}
    );
  };

  /** One cart line → supplier rank API only receives that product (correct supplier list). */
  const handleContinueToSupplierSelectionForItem = (item, group) => {
    const resolvedProject = resolveGroupBoqProjectForSupplierSelect(group);
    if (!resolvedProject?.shippingAddress) {
      setError('Please set a delivery address for this project before selecting suppliers.');
      return;
    }
    const groupWithShipping = {
      ...group,
      boqProject: {
        ...(group?.boqProject && typeof group.boqProject === 'object' ? group.boqProject : {}),
        ...resolvedProject
      }
    };
    const draft = buildDraftFromSingleItem(item, groupWithShipping);
    if (draft && typeof onLoadCart === 'function') onLoadCart(draft);
    persistSupplierSelectScopeFromCart(draft.items, draft.boqProject);
    const navState = supplierSelectNavigationState(draft);
    navigate(
      { pathname: '/supplier-select', search: '?from=cart' },
      navState ? { state: navState } : {}
    );
  };

  const handleShareCart = async () => {
    if (!token) {
      setError('Please log in again to share cart.');
      return;
    }
    setSharingCart(true);
    setError('');
    try {
      const response = await fetch(getApiUrl('/api/cart-share'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ttlDays: 7 })
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to create share link');
      }
      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const fallbackShareUrl = data?.token && baseOrigin ? `${baseOrigin}/c/${encodeURIComponent(data.token)}` : '';
      setShareLink(String(data.shareUrl || fallbackShareUrl || ''));
    } catch (e) {
      setError(e.message || 'Failed to create share link');
    } finally {
      setSharingCart(false);
    }
  };

  const handleShareViaWhatsApp = () => {
    if (!shareLink) {
      setError('Please generate the share link first.');
      return;
    }
    const text = `Please review this cart: ${shareLink}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    setShareLink('');
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleShareViaEmail = () => {
    if (!shareLink) {
      setError('Please generate the share link first.');
      return;
    }
    const subject = 'Shared Cart';
    const body = `Hi,\n\nPlease review this cart using the link below:\n${shareLink}\n\nThanks`;
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setShareLink('');
    window.location.href = mailtoUrl;
  };

  const handleCopyShareLink = async () => {
    if (!shareLink) return;
    try {
      setCopyingShareLink(true);
      await navigator.clipboard.writeText(shareLink);
      setCopyingShareLink(false);
      setShareLink('');
    } catch {
      setError('Unable to copy the share link. Please copy it manually.');
      setCopyingShareLink(false);
    }
  };

  const totalQty = allItems.reduce((sum, it) => sum + (Number(it?.quantity) || 1), 0);

  return (
    <SpWorkflowPage
      title="Shopping cart"
      description="Review line items, adjust quantities, then choose suppliers before creating a purchase order."
      icon={ShoppingCart}
    >
      <VoiceGuidedBanner />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={loadCart} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleClearCart}
          disabled={clearingCart || loading || allItems.length === 0}
        >
          <Trash2 className="h-4 w-4" />
          {clearingCart ? 'Clearing…' : 'Clear cart'}
        </Button>
        {allItems.length > 0 ? (
          <Badge variant="secondary" className="ml-auto">
            {allItems.length} line{allItems.length === 1 ? '' : 's'} · {totalQty} units
          </Badge>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <Card key={i}>
                  <CardHeader>
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : allItems.length === 0 ? (
            <SpEmptyState
              icon={Package}
              title="Your cart is empty"
              description="Browse the catalog or upload a BOQ to add materials to your cart."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button onClick={() => navigate('/product-discovery')}>Browse catalog</Button>
                  <Button variant="outline" onClick={() => navigate('/boq-normalize')}>
                    Upload BOQ
                  </Button>
                </div>
              }
            />
          ) : (
            groups.map((group, groupIndex) => {
              const items = Array.isArray(group?.items) ? group.items : [];
              const groupId = String(group?.groupId || '');
              const isEditing = editingGroupId === groupId;
              const shippingDraft =
                draftGroupShipping[groupId] || buildGroupShippingDraft(group, shippingAddressBook);
              const shippingPreview = getGroupShippingPreview(group);

              const beginEditingGroup = async () => {
                const addresses = shippingAddressBook.length
                  ? shippingAddressBook
                  : await loadProfileShippingAddresses();
                setEditingGroupId(groupId);
                setDraftGroupNames((prev) => ({
                  ...prev,
                  [groupId]: String(group?.boqName || '')
                }));
                setDraftGroupDates((prev) => ({
                  ...prev,
                  [groupId]: getGroupRequiredDate(group)
                }));
                setDraftGroupShipping((prev) => ({
                  ...prev,
                  [groupId]: buildGroupShippingDraft(group, addresses)
                }));
              };

              const fillShippingFromCurrentLocation = async () => {
                setLocatingShippingByGroup((prev) => ({ ...prev, [groupId]: true }));
                try {
                  const resolved = await resolveAddressFromCurrentLocation();
                  setDraftGroupShipping((prev) => ({
                    ...prev,
                    [groupId]: {
                      selectedShippingAddressId: '__new__',
                      newShippingAddress: {
                        label: resolved.city || 'Current location',
                        line1: resolved.line1 || '',
                        city: resolved.city || '',
                        state: resolved.state || '',
                        pincode: resolved.pincode || '',
                        country: resolved.country || 'India'
                      }
                    }
                  }));
                } catch (locationError) {
                  window.alert(getGeolocationErrorMessage(locationError));
                } finally {
                  setLocatingShippingByGroup((prev) => ({ ...prev, [groupId]: false }));
                }
              };

              return (
                <Card key={String(group?.groupId || groupIndex)} className="sp-market-card overflow-hidden">
                  <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 border-b bg-muted/30 pb-4">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">
                        {isEditing ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="text"
                                className="h-9 min-w-[180px] flex-1 rounded-md border bg-background px-2 text-sm"
                                maxLength={120}
                                value={draftGroupNames[groupId] ?? String(group?.boqName || '')}
                                onChange={(e) =>
                                  setDraftGroupNames((prev) => ({
                                    ...prev,
                                    [groupId]: e.target.value
                                  }))
                                }
                              />
                              <input
                                type="date"
                                className="h-9 rounded-md border bg-background px-2 text-sm"
                                value={draftGroupDates[groupId] ?? getGroupRequiredDate(group)}
                                onChange={(e) =>
                                  setDraftGroupDates((prev) => ({
                                    ...prev,
                                    [groupId]: e.target.value
                                  }))
                                }
                              />
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={Boolean(busyByGroupId[groupId])}
                                onClick={() =>
                                  updateProjectDetails(
                                    groupId,
                                    draftGroupNames[groupId] ?? String(group?.boqName || ''),
                                    draftGroupDates[groupId] ?? getGroupRequiredDate(group)
                                  )
                                }
                              >
                                <Check className="h-4 w-4" />
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingGroupId('');
                                  setDraftGroupNames((prev) => ({
                                    ...prev,
                                    [groupId]: String(group?.boqName || '')
                                  }));
                                  setDraftGroupDates((prev) => ({
                                    ...prev,
                                    [groupId]: getGroupRequiredDate(group)
                                  }));
                                  setDraftGroupShipping((prev) => {
                                    const { [groupId]: _removed, ...rest } = prev;
                                    return rest;
                                  });
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                            <div className="space-y-2 rounded-lg border bg-background p-3">
                              <div>
                                <p className="text-sm font-medium">Delivery address</p>
                                <p className="text-xs text-muted-foreground">
                                  Suppliers are ranked by distance to this address.
                                </p>
                              </div>
                              <select
                                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                                value={shippingDraft.selectedShippingAddressId}
                                onChange={(event) => {
                                  const next = event.target.value;
                                  setDraftGroupShipping((prev) => ({
                                    ...prev,
                                    [groupId]: {
                                      selectedShippingAddressId: next,
                                      newShippingAddress:
                                        next === '__new__'
                                          ? prev[groupId]?.newShippingAddress || { ...blankShippingAddress }
                                          : { ...blankShippingAddress }
                                    }
                                  }));
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
                              {shippingDraft.selectedShippingAddressId === '__new__' ? (
                                <div className="space-y-2">
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                                    onClick={fillShippingFromCurrentLocation}
                                    disabled={Boolean(locatingShippingByGroup[groupId])}
                                  >
                                    <MapPin className="h-4 w-4" />
                                    {locatingShippingByGroup[groupId]
                                      ? 'Detecting location…'
                                      : 'Use my current location'}
                                  </button>
                                  <Input
                                    maxLength={120}
                                    placeholder="Address label (e.g. Site A)"
                                    value={shippingDraft.newShippingAddress.label}
                                    onChange={(event) =>
                                      setDraftGroupShipping((prev) => ({
                                        ...prev,
                                        [groupId]: {
                                          ...shippingDraft,
                                          newShippingAddress: {
                                            ...shippingDraft.newShippingAddress,
                                            label: event.target.value
                                          }
                                        }
                                      }))
                                    }
                                  />
                                  <Input
                                    placeholder="Street address"
                                    value={shippingDraft.newShippingAddress.line1}
                                    onChange={(event) =>
                                      setDraftGroupShipping((prev) => ({
                                        ...prev,
                                        [groupId]: {
                                          ...shippingDraft,
                                          newShippingAddress: {
                                            ...shippingDraft.newShippingAddress,
                                            line1: event.target.value
                                          }
                                        }
                                      }))
                                    }
                                  />
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      placeholder="City"
                                      value={shippingDraft.newShippingAddress.city}
                                      onChange={(event) =>
                                        setDraftGroupShipping((prev) => ({
                                          ...prev,
                                          [groupId]: {
                                            ...shippingDraft,
                                            newShippingAddress: {
                                              ...shippingDraft.newShippingAddress,
                                              city: event.target.value
                                            }
                                          }
                                        }))
                                      }
                                    />
                                    <Input
                                      placeholder="State"
                                      value={shippingDraft.newShippingAddress.state}
                                      onChange={(event) =>
                                        setDraftGroupShipping((prev) => ({
                                          ...prev,
                                          [groupId]: {
                                            ...shippingDraft,
                                            newShippingAddress: {
                                              ...shippingDraft.newShippingAddress,
                                              state: event.target.value
                                            }
                                          }
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <Input
                                      placeholder="PIN code"
                                      value={shippingDraft.newShippingAddress.pincode}
                                      onChange={(event) =>
                                        setDraftGroupShipping((prev) => ({
                                          ...prev,
                                          [groupId]: {
                                            ...shippingDraft,
                                            newShippingAddress: {
                                              ...shippingDraft.newShippingAddress,
                                              pincode: event.target.value
                                            }
                                          }
                                        }))
                                      }
                                    />
                                    <Input
                                      placeholder="Country"
                                      value={shippingDraft.newShippingAddress.country}
                                      onChange={(event) =>
                                        setDraftGroupShipping((prev) => ({
                                          ...prev,
                                          [groupId]: {
                                            ...shippingDraft,
                                            newShippingAddress: {
                                              ...shippingDraft.newShippingAddress,
                                              country: event.target.value
                                            }
                                          }
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-2">
                            {String(group?.boqName || `BOQ group ${groupIndex + 1}`)}
                            <button
                              type="button"
                              className="inline-flex items-center text-muted-foreground hover:text-foreground"
                              onClick={beginEditingGroup}
                              aria-label="Edit project details"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </span>
                        )}
                      </CardTitle>
                      {group?.boqProject?.name ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Project: {String(group.boqProject.name)}
                        </p>
                      ) : null}
                      {getGroupRequiredDate(group) ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            Expected delivery: {formatDateIST(getGroupRequiredDate(group), '—')}
                          </span>
                        </p>
                      ) : null}
                      {!isEditing ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">Delivery address:</span>{' '}
                          {shippingPreview || (
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={beginEditingGroup}
                            >
                              Not set — add address
                            </button>
                          )}
                        </p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {items.length} item{items.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={items.length === 0}
                      onClick={() => handleContinueToSupplierSelectionForGroup(group)}
                    >
                      All in group
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ul className="divide-y">
                      {items.map((item) => {
                        const itemId = String(item?.id || '');
                        const quantity = Number(item?.quantity || 1);
                        const isBusy = Boolean(busyByItemId[itemId]);
                        const name = String(
                          item?.normalizedName || item?.rawName || item?.name || 'Item'
                        );
                        return (
                          <li
                            key={itemId || `${groupIndex}-${name}`}
                            className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-foreground">{name}</p>
                              <p className="mt-0.5 text-sm text-muted-foreground">
                                Unit: {String(item?.unit || 'nos')}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                              <div className="flex items-center rounded-md border bg-background">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-none"
                                  disabled={isBusy}
                                  onClick={() =>
                                    quantity <= 1
                                      ? removeItem(itemId)
                                      : updateQuantity(itemId, quantity - 1)
                                  }
                                  aria-label={quantity <= 1 ? 'Remove item' : 'Decrease quantity'}
                                >
                                  {quantity <= 1 ? <Trash2 className="h-4 w-4" /> : '−'}
                                </Button>
                                <span className="min-w-[2.5rem] text-center text-sm font-semibold tabular-nums">
                                  {isBusy ? '…' : quantity}
                                </span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 rounded-none"
                                  disabled={isBusy}
                                  onClick={() => updateQuantity(itemId, quantity + 1)}
                                  aria-label="Increase quantity"
                                >
                                  +
                                </Button>
                              </div>
                              <Button
                                size="sm"
                                disabled={!itemId}
                                onClick={() => handleContinueToSupplierSelectionForItem(item, group)}
                              >
                                Select supplier
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card className="sp-market-card shadow-md">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Order summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Line items</span>
                <span className="font-medium">{allItems.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total quantity</span>
                <span className="font-medium">{totalQty}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">BOQ groups</span>
                <span className="font-medium">{groups.length}</span>
              </div>
              <Separator />
              <p className="text-xs text-muted-foreground">
                Supplier pricing is confirmed in the next step. Continue when your cart looks correct.
              </p>
            </CardContent>
            <CardFooter className="flex flex-col gap-2 border-t bg-muted/20 pt-4">
              <Button
                className="w-full"
                size="lg"
                disabled={loading || allItems.length === 0}
                onClick={() => {
                  if (groups[0]) handleContinueToSupplierSelectionForGroup(groups[0]);
                  else navigate('/supplier-select');
                }}
              >
                Continue to suppliers
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="w-full"
                disabled={allItems.length === 0}
                onClick={handleSkipToCreatePo}
              >
                Skip to create PO
              </Button>
            </CardFooter>
          </Card>

          {allItems.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Share cart</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  className="w-full"
                  size="sm"
                  onClick={handleShareCart}
                  disabled={sharingCart || loading}
                >
                  <Share2 className="h-4 w-4" />
                  {sharingCart ? 'Generating link…' : 'Generate share link'}
                </Button>
                {shareLink ? (
                  <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs font-medium text-muted-foreground">Share link</p>
                    <a
                      href={shareLink}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-xs text-primary hover:underline"
                    >
                      {shareLink}
                    </a>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" size="sm" onClick={handleCopyShareLink}>
                        {copyingShareLink ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                        {copyingShareLink ? 'Copied' : 'Copy'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={handleShareViaWhatsApp}>
                        <MessageCircle className="h-4 w-4" />
                        WhatsApp
                      </Button>
                      <Button variant="secondary" size="sm" onClick={handleShareViaEmail}>
                        <Mail className="h-4 w-4" />
                        Email
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </SpWorkflowPage>
  );
};

export default Cart;
