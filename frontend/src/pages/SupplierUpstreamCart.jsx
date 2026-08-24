import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getApiUrl, authFetch } from '../config/api';
import './Dashboard.css';
import './SupplierUpstreamCart.css';
import { Check, Clipboard, Mail, MapPin, MessageCircle, Pencil, Share2, Trash2 } from 'lucide-react';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpStatCard from '../components/sp/SpStatCard';
import UpstreamProductDisplay from '../components/UpstreamProductDisplay';
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
import { SUPPLIER_CURRENT_STOCK_LABEL } from '../utils/supplierStockLabel';
import { formatRupee, lineMoneyTotal, roundMoney } from '../utils/formatRupee';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';
import {
  buildSupplierProductLookupMap,
  normalizeSupplierProductsFromApi,
  normalizeSupplierProductKey
} from '../utils/supplierProductRow';
import { hasUpstreamProjectCartLines } from '../utils/cartBadge';
import {
  formatShippingAddressLabel,
  formatShippingAddressOptionLabel,
  formatShippingAddressPreview,
  normalizeShippingAddressBookEntry
} from '../utils/shippingAddressLabel';
import {
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../utils/currentLocationAddress';
import './CreatePO.css';
import { formatDateIST, getTodayDateInputValue, isDateBeforeToday } from '../utils/dateTime';
import {
  buildCheckoutHoldExpiredMessage,
  clearCheckoutHoldExpired,
  SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY
} from '../utils/upstreamCheckoutReservation';
import {
  SUPPLIER_UPSTREAM_CART_RESUME_KEY,
  clearUpstreamCartClientProjectState,
  emitSupplierCartUpdated,
  resolveUpstreamProjectCartName,
  subscribeSupplierCartUpdated
} from '../utils/supplierUpstreamCartSession';
import {
  formatDiscoveryMrp,
  resolveDiscoveryDisplayPricing
} from '../utils/discoveryPricing';

const todayDateMin = getTodayDateInputValue();

const blankShippingAddress = {
  label: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India'
};

function resolveSelectedUpstreamOffer(project, mineId) {
  const key = normalizeSupplierProductKey(mineId);
  const rawSelection = project?.selectedUpstreamOffer?.[key] ?? project?.selectedUpstreamOffer?.[mineId];
  const offerId =
    typeof rawSelection === 'object' && rawSelection
      ? normalizeSupplierProductKey(
          rawSelection.upstreamSupplierProductId || rawSelection.id || rawSelection.offerId
        )
      : normalizeSupplierProductKey(rawSelection);
  if (offerId) {
    const suggestions = Array.isArray(project?.suggestions) ? project.suggestions : [];
    for (const item of suggestions) {
      const itemMineId = normalizeSupplierProductKey(item?.mineSupplierProductId);
      if (itemMineId && itemMineId !== key) continue;
      const offers = Array.isArray(item?.upstreamOffers) ? item.upstreamOffers : [];
      const match = offers.find(
        (o) => normalizeSupplierProductKey(o?.upstreamSupplierProductId || o?.id) === offerId
      );
      if (match) return match;
    }
  }
  if (typeof rawSelection === 'object' && rawSelection) return rawSelection;
  return null;
}

function resolveUpstreamCartLinePricing(project, mineId, product) {
  const offer = resolveSelectedUpstreamOffer(project, mineId);
  if (offer) {
    return resolveDiscoveryDisplayPricing({
      price: offer.price,
      mrp: offer.mrp ?? offer.basePrice,
      basePrice: offer.basePrice ?? offer.mrp,
      bcovApplied: offer.bcovApplied
    });
  }
  const fallback = Number(product?.price || product?.unitPrice || product?.sellingPrice || 0) || 0;
  return {
    price: fallback > 0 ? fallback : null,
    mrp: fallback > 0 ? fallback : null,
    bcovApplied: false
  };
}

const normalizeSelectionMap = (raw) => {
  if (!raw || typeof raw !== 'object') return {};
  const next = {};
  Object.entries(raw).forEach(([key, val]) => {
    const normalizedKey = normalizeSupplierProductKey(key);
    if (normalizedKey) next[normalizedKey] = val;
  });
  return next;
};
const SupplierUpstreamCart = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [holdExpiredNotice, setHoldExpiredNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const [projects, setProjects] = useState([]);
  const [products, setProducts] = useState([]);
  const [editingProjectId, setEditingProjectId] = useState('');
  const [projectNameDraft, setProjectNameDraft] = useState('');
  const [projectDateDraft, setProjectDateDraft] = useState('');
  const [savingProjectName, setSavingProjectName] = useState(false);
  const [sharingCart, setSharingCart] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const [copyingShareLink, setCopyingShareLink] = useState(false);
  const [shippingAddressBook, setShippingAddressBook] = useState([]);
  const [draftProjectShipping, setDraftProjectShipping] = useState({});
  const [locatingShippingByProject, setLocatingShippingByProject] = useState({});
  const [pendingRemoveLine, setPendingRemoveLine] = useState(null);
  const [removingLineKey, setRemovingLineKey] = useState('');

  const getProjectShippingPreview = (project) => {
    if (!project || typeof project !== 'object') return '';
    if (project.location) return String(project.location);
    if (project.shippingAddress) return formatShippingAddressPreview(project.shippingAddress);
    return '';
  };

  const buildProjectShippingDraft = (project, addresses = shippingAddressBook) => {
    const savedId = String(project?.shippingAddressId || '').trim();
    if (savedId && addresses.some((entry) => entry.id === savedId)) {
      return { selectedShippingAddressId: savedId, newShippingAddress: { ...blankShippingAddress } };
    }
    if (project?.shippingAddress && typeof project.shippingAddress === 'object') {
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
    const token = localStorage.getItem('token');
    if (!token) return [];
    try {
      const res = await fetch(getApiUrl('/api/profile'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || !data?.profile) return [];
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

  const productBySupplierProductId = useMemo(
    () => buildSupplierProductLookupMap(products),
    [products]
  );

  const projectRows = useMemo(
    () =>
      (projects || [])
        .map((project) => {
        const selectedMine = project?.selectedMine && typeof project.selectedMine === 'object'
          ? project.selectedMine
          : {};
        const structuredItems = Array.isArray(project?.items) ? project.items : [];
        const lineSources = structuredItems.length
          ? structuredItems.map((item) => ({
              mineId: normalizeSupplierProductKey(item?.mineSupplierProductId || item?.mineId),
              quantity: item?.quantity,
              lineMeta: item
            }))
          : Object.entries(selectedMine).map(([mineId, qty]) => ({
              mineId: normalizeSupplierProductKey(mineId),
              quantity: qty,
              lineMeta: null
            }));
        const rows = lineSources
          .map(({ mineId, quantity: lineQuantity, lineMeta }) => {
            const key = normalizeSupplierProductKey(mineId);
            const parsed = parseSupplierStockQuantity(lineQuantity);
            if (!key || parsed == null || parsed <= 0) return null;
            const product = productBySupplierProductId[key];
            if (!product) return null;
            const quantity = parsed;
            const variantLabel = String(
              lineMeta?.variantLabel ||
                lineMeta?.variantAsin ||
                product?.variantAsin ||
                lineMeta?.variantKey ||
                product?.variantKey ||
                ''
            ).trim();
            return {
              mineId: key,
              quantity,
              product,
              variantLabel
            };
          })
          .filter(Boolean);
        return { project, rows };
      })
        .filter(({ rows }) => rows.length > 0),
    [projects, productBySupplierProductId]
  );
  const projectCount = projectRows.length;
  const totalCartLines = projectRows.reduce((sum, item) => sum + item.rows.length, 0);
  const totalCartQuantity = projectRows.reduce(
    (sum, item) => sum + item.rows.reduce((rowSum, row) => rowSum + Number(row.quantity || 0), 0),
    0
  );

  const applyCartDraft = (draft) => {
    const nextProjects = (Array.isArray(draft?.projects) ? draft.projects : [])
      .filter(hasUpstreamProjectCartLines)
      .map((project) => ({
        ...project,
        cartName: resolveUpstreamProjectCartName(project?.cartName)
      }));
    setProjects(nextProjects);
    if (nextProjects.length === 0) {
      clearUpstreamCartClientProjectState();
    }
  };

  const loadCart = async () => {
    setLoading(true);
    setError('');
    try {
      const [cartRes, productsRes] = await Promise.all([
        authFetch('/api/supplier/upstream/cart', { cache: 'no-cache' }),
        authFetch('/api/supplier/products', { cache: 'no-cache' })
      ]);
      const cartData = await cartRes.json();
      const productsData = await productsRes.json();
      if (!cartRes.ok || cartData.status !== 'success') {
        throw new Error(cartData.message || 'Failed to load cart');
      }
      if (!productsRes.ok || productsData.status !== 'success') {
        throw new Error(productsData.message || 'Failed to load products');
      }
      const draft = cartData?.cart?.draft && typeof cartData.cart.draft === 'object' ? cartData.cart.draft : {};
      applyCartDraft(draft);
      setProducts(
        normalizeSupplierProductsFromApi(
          Array.isArray(productsData.products) ? productsData.products : []
        )
      );
    } catch (e) {
      setError(e.message || 'Failed to load supplier cart');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!location.state?.checkoutHoldExpired) return;
    setHoldExpiredNotice(
      String(location.state.message || '').trim() || buildCheckoutHoldExpiredMessage()
    );
    navigate('/supplier-cart', { replace: true, state: {} });
  }, [location.state, navigate]);

  useEffect(() => {
    loadCart();
    loadProfileShippingAddresses();
    const unsubscribe = subscribeSupplierCartUpdated(
      () => {
        void loadCart();
      },
      { includeSameWindow: false, includeFocus: false }
    );
    return unsubscribe;
  }, []);

  const replaceProjectInState = (projectId, nextProject) => {
    setProjects((prev) =>
      (prev || []).map((project) =>
        String(project?.projectId || '') === String(projectId || '') ? nextProject : project
      )
    );
  };

  const persistProject = async (project, options = {}) => {
    const silent = options.silent === true;
    if (!silent) setSaving(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId: project.projectId,
          cartName: String(project.cartName || '').trim(),
          requiredDate: String(project.requiredDate || '').trim(),
          selectedMine: project.selectedMine || {},
          ...(Array.isArray(project.items)
            ? {
                items: project.items.map((item) => ({
                  id: item?.id,
                  mineSupplierProductId: item?.mineSupplierProductId || item?.mineId,
                  mineId: item?.mineId,
                  productId: item?.productId,
                  variantKey: item?.variantKey,
                  variantAsin: item?.variantAsin,
                  variantLabel: item?.variantLabel,
                  name: item?.name,
                  quantity: item?.quantity
                }))
              }
            : {}),
          selectedUpstreamOffer: project.selectedUpstreamOffer || {},
          suggestions: Array.isArray(project.suggestions) ? project.suggestions : [],
          brandFilter: String(project.brandFilter || '').trim(),
          searchTerm: String(project.searchTerm || '').trim()
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to save project');
      }
      if (data?.cart?.draft && typeof data.cart.draft === 'object') {
        applyCartDraft(data.cart.draft);
      }
      return true;
    } catch (e) {
      setError(e.message || 'Failed to save project');
      return false;
    } finally {
      if (!silent) setSaving(false);
    }
  };

  const updateQuantity = async (projectId, mineId, nextQty) => {
    const key = normalizeSupplierProductKey(mineId);
    const parsed = parseSupplierStockQuantity(nextQty);
    if (parsed === null || parsed < 1) return;
    const quantity = Math.max(1, parsed);
    const project = (projects || []).find((p) => String(p?.projectId || '') === String(projectId || ''));
    if (!project) return;
    const existingItems = Array.isArray(project.items) ? project.items : [];
    const itemExists = existingItems.some(
      (item) => normalizeSupplierProductKey(item?.mineSupplierProductId || item?.mineId) === key
    );
    const nextProject = {
      ...project,
      selectedMine: {
        ...(project.selectedMine || {}),
        [key]: quantity
      },
      items: itemExists
        ? existingItems.map((item) =>
            normalizeSupplierProductKey(item?.mineSupplierProductId || item?.mineId) === key
              ? { ...item, quantity }
              : item
          )
        : [
            ...existingItems,
            {
              mineSupplierProductId: key,
              quantity
            }
          ]
    };
    replaceProjectInState(projectId, nextProject);
    const ok = await persistProject(nextProject, { silent: true });
    if (!ok) {
      void loadCart();
      return;
    }
    emitSupplierCartUpdated();
  };

  const removeLine = async (projectId, mineId) => {
    const key = normalizeSupplierProductKey(mineId);
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId || !key) return;
    const project = (projects || []).find((p) => String(p?.projectId || '') === normalizedProjectId);
    if (!project) return;

    const lineKey = `${normalizedProjectId}:${key}`;
    setRemovingLineKey(lineKey);
    setError('');

    const nextSelectedMine = {};
    for (const [id, qty] of Object.entries(project.selectedMine || {})) {
      if (normalizeSupplierProductKey(id) === key) continue;
      const quantity = Number(qty);
      if (Number.isFinite(quantity) && quantity > 0) {
        nextSelectedMine[normalizeSupplierProductKey(id)] = quantity;
      }
    }
    const nextSelectedUpstreamOffer = { ...(project.selectedUpstreamOffer || {}) };
    delete nextSelectedUpstreamOffer[key];
    delete nextSelectedUpstreamOffer[mineId];
    const nextItems = Array.isArray(project.items)
      ? project.items.filter(
          (item) =>
            normalizeSupplierProductKey(item?.mineSupplierProductId || item?.mineId) !== key
        )
      : [];
    const nextProject = {
      ...project,
      selectedMine: nextSelectedMine,
      selectedUpstreamOffer: nextSelectedUpstreamOffer,
      items: nextItems
    };
    const projectNowEmpty = nextItems.length === 0 && Object.keys(nextSelectedMine).length === 0;
    if (projectNowEmpty) {
      setProjects((prev) => {
        const remaining = (prev || []).filter(
          (p) => String(p?.projectId || '') !== normalizedProjectId
        );
        if (remaining.length === 0) {
          clearUpstreamCartClientProjectState();
        }
        return remaining;
      });
    } else {
      replaceProjectInState(normalizedProjectId, nextProject);
    }

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        throw new Error('Please log in again to remove this product.');
      }
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart/items'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          mineSupplierProductId: key,
          quantity: 0,
          replaceQuantity: true,
          projectId: normalizedProjectId
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to remove product from cart');
      }
      const serverDraft =
        data?.cart?.draft && typeof data.cart.draft === 'object' ? data.cart.draft : null;
      if (serverDraft) {
        applyCartDraft(serverDraft);
      } else {
        await loadCart();
      }
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to remove product from cart');
      await loadCart();
    } finally {
      setRemovingLineKey('');
    }
  };

  const requestRemoveLine = (projectId, mineId, name) => {
    if (!projectId || !mineId) return;
    setPendingRemoveLine({
      projectId,
      mineId,
      name: String(name || '').trim()
    });
  };

  const handleConfirmRemoveLine = async () => {
    const projectId = pendingRemoveLine?.projectId;
    const mineId = pendingRemoveLine?.mineId;
    setPendingRemoveLine(null);
    if (projectId && mineId) await removeLine(projectId, mineId);
  };

  const clearCart = async () => {
    const confirmed = window.confirm('Clear supplier cart?');
    if (!confirmed) return;
    setClearing(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to clear cart');
      }
      setProjects([]);
      clearUpstreamCartClientProjectState();
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to clear cart');
    } finally {
      setClearing(false);
    }
  };

  const continueToUpstream = async (project) => {
    clearCheckoutHoldExpired(SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY);
    localStorage.setItem(
      SUPPLIER_UPSTREAM_CART_RESUME_KEY,
      JSON.stringify({
        projectId: String(project?.projectId || '').trim(),
        shippingAddressId: String(project?.shippingAddressId || '').trim(),
        selectedMine: normalizeSelectionMap(project?.selectedMine),
        selectedUpstreamOffer: normalizeSelectionMap(project?.selectedUpstreamOffer),
        suggestions: Array.isArray(project?.suggestions) ? project.suggestions : [],
        brandFilter: String(project?.brandFilter || ''),
        searchTerm: String(project?.searchTerm || ''),
        cartName: String(project?.cartName || '')
      })
    );
    navigate('/supplier-upstream');
  };

  const resolveProjectShippingPayload = async (projectId) => {
    const draft = draftProjectShipping[projectId] || buildProjectShippingDraft({});
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
      const token = localStorage.getItem('token');
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

  const beginEditingProject = async (project) => {
    const projectId = String(project?.projectId || '');
    const addresses = shippingAddressBook.length
      ? shippingAddressBook
      : await loadProfileShippingAddresses();
    setEditingProjectId(projectId);
    setProjectNameDraft(String(project?.cartName || ''));
    setProjectDateDraft(String(project?.requiredDate || '').slice(0, 10));
    setDraftProjectShipping((prev) => ({
      ...prev,
      [projectId]: buildProjectShippingDraft(project, addresses)
    }));
  };

  const cancelEditingProject = (project) => {
    const projectId = String(project?.projectId || '');
    setEditingProjectId('');
    setProjectNameDraft('');
    setProjectDateDraft('');
    setDraftProjectShipping((prev) => {
      const { [projectId]: _removed, ...rest } = prev;
      return rest;
    });
  };

  const saveProjectDetails = async (projectId) => {
    const cartName = String(projectNameDraft || '').trim();
    const requiredDate = String(projectDateDraft || '').trim();
    if (!cartName) {
      setError('Project name cannot be empty.');
      return;
    }
    if (requiredDate && isDateBeforeToday(requiredDate)) {
      setError('Expected dispatch date cannot be in the past.');
      return;
    }
    setSavingProjectName(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const shippingPayload = await resolveProjectShippingPayload(projectId);
      const res = await fetch(getApiUrl('/api/supplier/upstream/cart/name'), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          projectId,
          cartName,
          requiredDate,
          shippingAddressId: shippingPayload.shippingAddressId ?? '',
          ...(shippingPayload.shippingAddress
            ? { shippingAddress: shippingPayload.shippingAddress }
            : {})
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update project details');
      }
      const current = (projects || []).find((p) => String(p?.projectId || '') === String(projectId || ''));
      const appliedShipping = data.project?.shippingAddress
        ? {
            shippingAddressId: data.project.shippingAddressId || null,
            shippingAddress: data.project.shippingAddress,
            location: data.project.location || null,
            siteGeo: data.project.siteGeo || null
          }
        : shippingPayload.clear
          ? {
              shippingAddressId: null,
              shippingAddress: null,
              location: null,
              siteGeo: null
            }
          : null;
      if (current) {
        const nextProject = {
          ...current,
          cartName,
          requiredDate
        };
        if (appliedShipping) {
          if (appliedShipping.shippingAddress) {
            nextProject.shippingAddress = appliedShipping.shippingAddress;
            if (appliedShipping.shippingAddressId) {
              nextProject.shippingAddressId = appliedShipping.shippingAddressId;
            } else {
              delete nextProject.shippingAddressId;
            }
            if (appliedShipping.location) nextProject.location = appliedShipping.location;
            else delete nextProject.location;
            if (appliedShipping.siteGeo) nextProject.siteGeo = appliedShipping.siteGeo;
            else delete nextProject.siteGeo;
          } else {
            delete nextProject.shippingAddress;
            delete nextProject.shippingAddressId;
            delete nextProject.location;
            delete nextProject.siteGeo;
          }
        }
        replaceProjectInState(projectId, nextProject);
      }
      cancelEditingProject({ projectId });
      emitSupplierCartUpdated();
    } catch (e) {
      setError(e.message || 'Failed to update project details');
    } finally {
      setSavingProjectName(false);
    }
  };

  const handleShareCart = async () => {
    const token = localStorage.getItem('token');
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
    const text = `Please review this supplier cart: ${shareLink}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleShareViaEmail = () => {
    if (!shareLink) {
      setError('Please generate the share link first.');
      return;
    }
    const subject = 'Shared Supplier Cart';
    const body = `Hi,\n\nPlease review this supplier cart using the link below:\n${shareLink}\n\nThanks`;
    const mailtoUrl = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoUrl;
  };

  const handleCopyShareLink = async () => {
    if (!shareLink) return;
    try {
      setCopyingShareLink(true);
      await navigator.clipboard.writeText(shareLink);
      window.setTimeout(() => setCopyingShareLink(false), 1000);
    } catch (_e) {
      setCopyingShareLink(false);
      setError('Unable to copy share link. Please copy manually.');
    }
  };

  return (
    <SpPageLayout showStepper={false}>
      <div className="dashboard-container supplier-cart-page !max-w-none !p-0">
      <SpPageHeader
        title="Supplier Cart"
        description="Every save creates a new project. Same product + same supplier will not merge into previous projects."
        icon={Pencil}
        actions={
          <>
            <Button variant="outline" disabled={loading || saving} onClick={loadCart}>
              Refresh
            </Button>
            <Button variant="outline" onClick={() => navigate('/supplier-upstream')}>
              Back to Upstream
            </Button>
          </>
        }
      />

      {holdExpiredNotice ? (
        <div className="supplier-cart-hold-expired-notice" role="status">
          {holdExpiredNotice}
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SpStatCard label="Projects" value={projectCount} icon={Pencil} accent="indigo" />
        <SpStatCard label="Cart Lines" value={totalCartLines} icon={Pencil} accent="emerald" />
        <SpStatCard label="Total Quantity" value={totalCartQuantity} icon={Pencil} accent="amber" />
      </div>

      <div className="dashboard-content supplier-cart-content">
        <div className="dashboard-section">
          <div className="section-header supplier-cart-toolbar">
            <h2>Projects</h2>
            <div className="supplier-cart-toolbar-actions">
              <button
                className="btn-secondary"
                disabled={loading || clearing || projectRows.length === 0}
                onClick={clearCart}
              >
                {clearing ? 'Clearing...' : 'Clear cart'}
              </button>
              <button
                className="btn-secondary"
                disabled={loading || sharingCart || projectRows.length === 0}
                onClick={handleShareCart}
              >
                <Share2 size={14} />
                {sharingCart ? 'Generating...' : 'Share cart'}
              </button>
            </div>
          </div>

          {error ? <div className="supplier-cart-error">{error}</div> : null}
          {shareLink ? (
            <div className="supplier-cart-share-panel">
              <div className="supplier-cart-share-title">Share link</div>
              <a href={shareLink} target="_blank" rel="noreferrer" className="supplier-cart-share-link">
                {shareLink}
              </a>
              <div className="supplier-cart-share-actions">
                <button className="btn-secondary" onClick={handleCopyShareLink}>
                  {copyingShareLink ? <Check size={14} /> : <Clipboard size={14} />}
                  {copyingShareLink ? 'Copied' : 'Copy'}
                </button>
                <button className="btn-secondary" onClick={handleShareViaWhatsApp}>
                  <MessageCircle size={14} />
                  WhatsApp
                </button>
                <button className="btn-secondary" onClick={handleShareViaEmail}>
                  <Mail size={14} />
                  Email
                </button>
              </div>
            </div>
          ) : null}

          {loading ? (
            <p>Loading cart...</p>
          ) : projectRows.length === 0 ? (
            <div className="empty-state">
              <h3>Your supplier cart is empty</h3>
              <p>Add products from Upstream Orders.</p>
              <button className="btn-primary" onClick={() => navigate('/supplier-upstream')}>
                Go to Upstream Orders
              </button>
            </div>
          ) : (
            <div className="supplier-projects-stack">
              {projectRows.map(({ project, rows }) => {
                const projectId = String(project?.projectId || '');
                const isEditing = editingProjectId === projectId;
                const shippingDraft =
                  draftProjectShipping[projectId] || buildProjectShippingDraft(project, shippingAddressBook);
                const shippingPreview = getProjectShippingPreview(project);
                const totalLines = rows.length;
                const totalQuantity = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
                const totalAmount = roundMoney(
                  rows.reduce((sum, row) => {
                    const pricing = resolveUpstreamCartLinePricing(project, row.mineId, row.product);
                    const unitPrice = Number(pricing.price || 0) || 0;
                    return sum + lineMoneyTotal(unitPrice, row.quantity);
                  }, 0)
                );
                return (
                  <section key={projectId} className="supplier-project-card">
                    <div className="supplier-project-head">
                      <div className="supplier-project-head-main">
                        {isEditing ? (
                          <div className="supplier-project-edit-block">
                            <div className="supplier-project-edit-row">
                              <input
                                type="text"
                                maxLength={120}
                                value={projectNameDraft}
                                onChange={(e) => setProjectNameDraft(e.target.value)}
                                className="supplier-project-name-input"
                              />
                              <input
                                type="date"
                                min={todayDateMin}
                                value={projectDateDraft}
                                onChange={(e) => {
                                  setProjectDateDraft(e.target.value);
                                }}
                                className="supplier-project-name-input"
                              />
                              <button
                                className="btn-primary"
                                disabled={savingProjectName}
                                onClick={() => saveProjectDetails(projectId)}
                              >
                                {savingProjectName ? 'Saving...' : 'Save'}
                              </button>
                              <button className="btn-secondary" onClick={() => cancelEditingProject(project)}>
                                Cancel
                              </button>
                            </div>
                            <div className="supplier-project-shipping-panel">
                              <div>
                                <p className="supplier-project-shipping-title">Shipping address</p>
                                <p className="supplier-project-shipping-hint">
                                  Optional. Saved to your profile when you add a new address.
                                </p>
                              </div>
                              <select
                                className="supplier-project-shipping-select"
                                value={shippingDraft.selectedShippingAddressId}
                                onChange={(event) => {
                                  const next = event.target.value;
                                  setDraftProjectShipping((prev) => ({
                                    ...prev,
                                    [projectId]: {
                                      selectedShippingAddressId: next,
                                      newShippingAddress:
                                        next === '__new__'
                                          ? prev[projectId]?.newShippingAddress || { ...blankShippingAddress }
                                          : { ...blankShippingAddress }
                                    }
                                  }));
                                }}
                              >
                                <option value="">No shipping address</option>
                                {shippingAddressBook.map((entry, index) => (
                                  <option key={entry.id} value={entry.id}>
                                    {formatShippingAddressOptionLabel(entry, index)}
                                  </option>
                                ))}
                                <option value="__new__">+ Add new address</option>
                              </select>
                              {shippingDraft.selectedShippingAddressId &&
                              shippingDraft.selectedShippingAddressId !== '__new__' ? (
                                <p className="supplier-project-shipping-preview">
                                  {formatShippingAddressPreview(
                                    shippingAddressBook.find(
                                      (entry) =>
                                        entry.id === shippingDraft.selectedShippingAddressId
                                    ) || {}
                                  )}
                                </p>
                              ) : null}
                              {shippingDraft.selectedShippingAddressId === '__new__' ? (
                                <div className="supplier-project-shipping-form">
                                  <button
                                    type="button"
                                    className="checkout-location-btn"
                                    onClick={async () => {
                                      setLocatingShippingByProject((prev) => ({ ...prev, [projectId]: true }));
                                      try {
                                        const resolved = await resolveAddressFromCurrentLocation();
                                        setDraftProjectShipping((prev) => ({
                                          ...prev,
                                          [projectId]: {
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
                                        setLocatingShippingByProject((prev) => ({ ...prev, [projectId]: false }));
                                      }
                                    }}
                                    disabled={Boolean(locatingShippingByProject[projectId])}
                                  >
                                    <MapPin size={15} aria-hidden />
                                    {locatingShippingByProject[projectId]
                                      ? 'Detecting location…'
                                      : 'Use my current location'}
                                  </button>
                                  <Input
                                    maxLength={120}
                                    placeholder="Address label (e.g. Warehouse)"
                                    value={shippingDraft.newShippingAddress.label}
                                    onChange={(event) =>
                                      setDraftProjectShipping((prev) => ({
                                        ...prev,
                                        [projectId]: {
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
                                      setDraftProjectShipping((prev) => ({
                                        ...prev,
                                        [projectId]: {
                                          ...shippingDraft,
                                          newShippingAddress: {
                                            ...shippingDraft.newShippingAddress,
                                            line1: event.target.value
                                          }
                                        }
                                      }))
                                    }
                                  />
                                  <div className="supplier-project-shipping-grid">
                                    <Input
                                      placeholder="City"
                                      value={shippingDraft.newShippingAddress.city}
                                      onChange={(event) =>
                                        setDraftProjectShipping((prev) => ({
                                          ...prev,
                                          [projectId]: {
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
                                        setDraftProjectShipping((prev) => ({
                                          ...prev,
                                          [projectId]: {
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
                                  <div className="supplier-project-shipping-grid">
                                    <Input
                                      placeholder="PIN code"
                                      value={shippingDraft.newShippingAddress.pincode}
                                      onChange={(event) =>
                                        setDraftProjectShipping((prev) => ({
                                          ...prev,
                                          [projectId]: {
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
                                        setDraftProjectShipping((prev) => ({
                                          ...prev,
                                          [projectId]: {
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
                          <h3 className="supplier-project-title">
                            {String(project?.cartName || 'Supplier Project')}
                            <button
                              type="button"
                              className="btn-icon supplier-project-edit-icon"
                              onClick={() => beginEditingProject(project)}
                              aria-label="Edit project details"
                            >
                              <Pencil size={14} />
                            </button>
                          </h3>
                        )}
                        <p className="supplier-project-id">Project ID: {projectId}</p>
                        {String(project?.requiredDate || '').trim() ? (
                          <p className="supplier-project-id">
                            <strong>Expected dispatch: {formatDateIST(project.requiredDate, '—')}</strong>
                          </p>
                        ) : null}
                        {!isEditing ? (
                          <p className="supplier-project-id">
                            <strong>Shipping address:</strong>{' '}
                            {shippingPreview || (
                              <button
                                type="button"
                                className="supplier-project-add-address"
                                onClick={() => beginEditingProject(project)}
                              >
                                Not set — add address
                              </button>
                            )}
                          </p>
                        ) : null}
                      </div>
                      <div className="supplier-project-head-actions">
                        <button className="btn-primary" disabled={rows.length === 0} onClick={() => continueToUpstream(project)}>
                          Continue this project
                        </button>
                      </div>
                    </div>

                    <div className="supplier-table-wrap">
                      <table className="supplier-cart-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Brand</th>
                            <th>MRP</th>
                            <th>{SUPPLIER_CURRENT_STOCK_LABEL}</th>
                            <th>Min Order</th>
                            <th>Quantity</th>
                            <th>Total Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => {
                            const mineId = row.mineId;
                            const p = row.product;
                            const minQty = Math.max(1, p?.min_order_quantity ?? 1);
                            const pricing = resolveUpstreamCartLinePricing(project, mineId, p);
                            const unitPrice = Number(pricing.price || 0) || 0;
                            const quantity = Number(row.quantity || 0);
                            const lineBusy = removingLineKey === `${projectId}:${mineId}`;
                            return (
                              <tr key={`${projectId}-${mineId}`}>
                                <td className="supplier-cart-product-cell">
                                  <div className="supplier-cart-product-name">{p?.name || 'Product'}</div>
                                  {row.variantLabel ? (
                                    <div className="supplier-cart-variant-label">
                                      Variant: {row.variantLabel}
                                    </div>
                                  ) : null}
                                  <UpstreamProductDisplay
                                    product={p}
                                    compact
                                    showDescription={false}
                                    showSpecifications={false}
                                    maxSpecs={8}
                                  />
                                </td>
                                <td>{p?.brandModel || p?.brand || 'N/A'}</td>
                                <td className="supplier-cart-number-cell">
                                  {pricing.bcovApplied && pricing.mrp ? (
                                    <span className="supplier-cart-mrp">{formatDiscoveryMrp(pricing.mrp)}</span>
                                  ) : null}{' '}
                                  {formatRupee(unitPrice)}
                                </td>
                                <td>{p?.stock ?? 0}</td>
                                <td>{minQty}</td>
                                <td>
                                  <div className="supplier-cart-qty-control">
                                    <button
                                      type="button"
                                      className="btn-secondary supplier-cart-qty-btn"
                                      disabled={lineBusy}
                                      onClick={() =>
                                        quantity <= 1
                                          ? requestRemoveLine(projectId, mineId, p?.name || row.variantLabel)
                                          : updateQuantity(projectId, mineId, quantity - 1)
                                      }
                                      aria-label={quantity <= 1 ? 'Remove item' : 'Decrease quantity'}
                                    >
                                      {quantity <= 1 ? <Trash2 size={14} /> : '−'}
                                    </button>
                                    <span className="supplier-cart-qty-value">{quantity}</span>
                                    <button
                                      type="button"
                                      className="btn-secondary supplier-cart-qty-btn"
                                      disabled={lineBusy}
                                      onClick={() => updateQuantity(projectId, mineId, quantity + 1)}
                                      aria-label="Increase quantity"
                                    >
                                      +
                                    </button>
                                  </div>
                                </td>
                                <td className="supplier-cart-number-cell">{formatRupee(lineMoneyTotal(unitPrice, row.quantity))}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan={4} className="supplier-cart-summary-label">
                              Project totals
                            </td>
                            <td className="supplier-cart-summary-value">{totalQuantity}</td>
                            <td className="supplier-cart-summary-value">{formatRupee(totalAmount)}</td>
                            <td className="supplier-cart-summary-meta">{totalLines} line(s)</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <p
                      style={{
                        marginTop: '0.6rem',
                        fontSize: '0.86rem',
                        color: '#64748b'
                      }}
                    >
                      <strong>
                        This is the total MRP price. To get the actual purchase price, select the supplier in the cart.
                      </strong>
                    </p>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
      </div>

      <Dialog
        open={Boolean(pendingRemoveLine)}
        onOpenChange={(open) => {
          if (!open) setPendingRemoveLine(null);
        }}
      >
        <DialogContent className="inset-auto left-1/2 top-1/2 h-auto w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg">
          <DialogHeader className="pr-8">
            <DialogTitle>Delete product</DialogTitle>
            <DialogDescription>
              Do you want to delete this product from the cart?
              {pendingRemoveLine?.name ? (
                <span className="mt-2 block font-medium text-foreground">{pendingRemoveLine.name}</span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingRemoveLine(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleConfirmRemoveLine}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SpPageLayout>
  );
};

export default SupplierUpstreamCart;
