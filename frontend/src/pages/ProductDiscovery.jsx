import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, ChevronLeft, ChevronRight, ImageOff, MapPin, Package, Search, ShoppingCart, Star, Tag, Users } from 'lucide-react';
import { getApiUrl } from '../config/api';
import ProductImageCarousel from '../components/ProductImageCarousel';
import { getProductImageList } from '../utils/productImages';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpEmptyState from '../components/sp/SpEmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { refreshServiceProviderCartCount } from '../utils/spCartBadge';
import { formatRupeePerUnit } from '../utils/formatRupee';
import {
  getGeolocationErrorMessage,
  resolveAddressFromCurrentLocation
} from '../utils/currentLocationAddress';
import {
  formatShippingAddressLabel,
  normalizeShippingAddressBookEntry
} from '../utils/shippingAddressLabel';
import { formatDateIST, getTodayDateInputValue, isDateBeforeToday } from '../utils/dateTime';
import './ProductDiscovery.css';

const blankShippingAddress = {
  label: '',
  line1: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India'
};

const todayDateMin = getTodayDateInputValue();

function formatPrice(price, unit) {
  const num = Number(price);
  if (!Number.isFinite(num) || num <= 0) return null;
  return formatRupeePerUnit(num, unit, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function RatingStars({ rating, reviews }) {
  const num = Number(rating);
  if (!Number.isFinite(num) || num <= 0) return null;
  const full = Math.floor(num);
  const hasHalf = num - full >= 0.25;
  return (
    <div className="pd-rating">
      <div className="pd-rating__stars">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={14}
            className={i < full ? 'pd-star--filled' : (i === full && hasHalf) ? 'pd-star--half' : 'pd-star--empty'}
          />
        ))}
      </div>
      <span className="pd-rating__value">{num.toFixed(1)}</span>
      {Number(reviews) > 0 && <span className="pd-rating__count">({reviews})</span>}
    </div>
  );
}

function SpecBadges({ specifications }) {
  if (!specifications || typeof specifications !== 'object') return null;
  const entries = Object.entries(specifications).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim()
  );
  if (!entries.length) return null;
  return (
    <div className="pd-specs">
      {entries.slice(0, 4).map(([key, val]) => (
        <span key={key} className="pd-spec-badge">
          <strong>{key}:</strong> {String(val)}
        </span>
      ))}
      {entries.length > 4 && <span className="pd-spec-badge pd-spec-more">+{entries.length - 4} more</span>}
    </div>
  );
}

function TagList({ tags }) {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!list.length) return null;
  return (
    <div className="pd-tags">
      <Tag size={12} />
      {list.slice(0, 5).map((t) => (
        <span key={t} className="pd-tag">{t}</span>
      ))}
      {list.length > 5 && <span className="pd-tag pd-tag--more">+{list.length - 5}</span>}
    </div>
  );
}

const ProductDiscovery = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchQuery = searchParams.get('q') || '';
  const selectedCategory = searchParams.get('category') || '';
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendationMode, setRecommendationMode] = useState('');
  const [cartBusyByProductId, setCartBusyByProductId] = useState({});
  const [cartAddedByProductId, setCartAddedByProductId] = useState({});
  const [cartProjects, setCartProjects] = useState([]);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [pendingProduct, setPendingProduct] = useState(null);
  const [targetProjectId, setTargetProjectId] = useState('__new__');
  const [newProjectName, setNewProjectName] = useState('');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState('');
  const [shippingAddressBook, setShippingAddressBook] = useState([]);
  const [selectedShippingAddressId, setSelectedShippingAddressId] = useState('');
  const [newShippingAddress, setNewShippingAddress] = useState(blankShippingAddress);
  const [locatingShippingAddress, setLocatingShippingAddress] = useState(false);
  const pageSize = 24;

  const updateSearchQuery = (value) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = String(value || '').trim();
        if (trimmed) next.set('q', trimmed);
        else next.delete('q');
        next.delete('page');
        return next;
      },
      { replace: true }
    );
    setPage(1);
  };

  const updateSelectedCategory = (value) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = String(value || '').trim();
        if (trimmed) next.set('category', trimmed);
        else next.delete('category');
        next.delete('page');
        return next;
      },
      { replace: true }
    );
    setPage(1);
  };

  const categories = useMemo(() => {
    const merged = new Map();

    categoryOptions.forEach((option) => {
      const value = String(option?.value || '').trim();
      if (!value) return;
      merged.set(value, String(option?.label || value).trim() || value);
    });

    // Keep discovered categories as fallback when API list is unavailable/incomplete.
    products.forEach((product) => {
      const category = String(product?.category || '').trim();
      if (category && !merged.has(category)) {
        merged.set(category, category);
      }
    });

    const selected = String(selectedCategory || '').trim();
    if (selected && !merged.has(selected)) {
      merged.set(selected, selected);
    }

    return Array.from(merged.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [categoryOptions, products, selectedCategory]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to discover products.');
      return undefined;
    }

    const timeoutId = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        if (selectedCategory.trim()) params.set('category', selectedCategory.trim());
        params.set('limit', String(pageSize));
        params.set('page', String(page));

        const response = await fetch(getApiUrl(`/api/supplier/products/search?${params.toString()}`), {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to fetch products');
        }
        setProducts(Array.isArray(data.suggestions) ? data.suggestions : []);
        setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : 0);
        setRecommendationMode(String(data.recommendationMode || ''));
        const discoveredCategories = (Array.isArray(data.categories) ? data.categories : [])
          .map((category) => {
            const value = String(category || '').trim();
            return value ? { value, label: value } : null;
          })
          .filter(Boolean);
        if (discoveredCategories.length > 0) {
          setCategoryOptions((prev) => {
            // Preserve current list while category is selected, but also merge any newly discovered category.
            if (selectedCategory.trim() && prev.length > 0) {
              const merged = new Map(prev.map((entry) => [entry.value, entry.label]));
              discoveredCategories.forEach((entry) => {
                if (!merged.has(entry.value)) {
                  merged.set(entry.value, entry.label);
                }
              });
              return Array.from(merged.entries())
                .map(([value, label]) => ({ value, label }))
                .sort((a, b) => a.label.localeCompare(b.label));
            }
            return discoveredCategories;
          });
        }
      } catch (fetchError) {
        setProducts([]);
        setTotal(0);
        setRecommendationMode('');
        setError(fetchError.message || 'Failed to fetch products');
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, selectedCategory, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedCategory]);

  useEffect(() => {
    const pageFromUrl = Number.parseInt(String(searchParams.get('page') || ''), 10);
    if (Number.isFinite(pageFromUrl) && pageFromUrl >= 1) {
      setPage(pageFromUrl);
    }
  }, [searchParams]);

  const pageCount = useMemo(() => {
    if (!total || total < 1) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total]);

  const safePage = Math.min(Math.max(page, 1), pageCount);

  const loadCartProjects = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      return [];
    }
    try {
      const response = await fetch(getApiUrl('/api/po/cart'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to fetch cart');
      }
      const groups = Array.isArray(data?.cart?.draft?.boqGroups) ? data.cart.draft.boqGroups : [];
      const normalizedGroups = groups
        .filter((group) => String(group?.groupId || '').trim())
        .map((group) => ({
          groupId: String(group.groupId),
          boqName: String(group?.boqName || '').trim() || 'Untitled project',
          requiredDate: String(group?.boqProject?.requiredDate || '').trim().slice(0, 10),
          shippingAddressId: String(group?.boqProject?.shippingAddressId || '').trim()
        }));
      setCartProjects(normalizedGroups);
      return normalizedGroups;
    } catch {
      return [];
    }
  };

  const loadProfileShippingAddresses = async () => {
    const token = localStorage.getItem('token');
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

  const openProjectPicker = async (product) => {
    const pid = String(product?.id || '').trim();
    if (!pid) {
      setError('This product cannot be added because its id is missing.');
      return;
    }
    if (Number(product?.supplierCount || 0) <= 0) {
      setError("This product is approved but not currently listed by an eligible supplier.");
      return;
    }
    const [groups, addresses] = await Promise.all([loadCartProjects(), loadProfileShippingAddresses()]);
    const initialProjectId = groups[0]?.groupId || '__new__';
    setPendingProduct(product);
    setTargetProjectId(initialProjectId);
    setNewProjectName(String(product?.name || '').trim());
    setExpectedDeliveryDate('');
    applyProjectShippingSelection(initialProjectId, groups, addresses);
    setProjectPickerOpen(true);
  };

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
      setError('Please log in again to add items to cart.');
      return false;
    }
    const productId = pendingProduct?.id;
    if (!productId) {
      setError('No product selected for adding to cart.');
      return false;
    }
    const isNewProject = targetProjectId === '__new__';
    if (isNewProject && !newProjectName.trim()) {
      setError('Please enter a project name for the new project.');
      return false;
    }
    if (isNewProject && !expectedDeliveryDate) {
      setError('Please select expected delivery date for the new project.');
      return false;
    }
    if (isNewProject && isDateBeforeToday(expectedDeliveryDate)) {
      setError('Expected delivery date cannot be in the past.');
      return false;
    }
    setCartBusyByProductId((prev) => ({ ...prev, [String(productId)]: true }));
    setError('');
    try {
      const shippingPayload = await resolveShippingPayload(token);
      const payload = {
        productId: String(productId),
        quantity: 1
      };
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
      setProjectPickerOpen(false);
      setPendingProduct(null);
      setCartAddedByProductId((prev) => ({ ...prev, [String(productId)]: true }));
      await refreshServiceProviderCartCount({ immediate: true });
      window.dispatchEvent(new Event('sp-workflow-updated'));
      toast.success('Added to cart');
      setTimeout(() => {
        setCartAddedByProductId((prev) => {
          const { [String(productId)]: _removed, ...rest } = prev;
          return rest;
        });
      }, 1400);
      return true;
    } catch (e) {
      setError(e.message || 'Failed to add to cart');
      return false;
    } finally {
      setCartBusyByProductId((prev) => {
        const { [String(productId)]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const imageArray = (product) => getProductImageList(product);

  return (
    <SpPageLayout>
      <VoiceGuidedBanner />
      <SpPageHeader
        title="Discover Products"
        description=""
        icon={Search}
        actions={
          <Button variant="outline" onClick={() => navigate('/boq-normalize')}>
            Upload BOQ
          </Button>
        }
      />

      <div className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-card/95 p-3 shadow-sm backdrop-blur">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name, brand, category, or description..."
            value={searchQuery}
            onChange={(event) => updateSearchQuery(event.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={selectedCategory}
          onChange={(event) => updateSelectedCategory(event.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <strong className="text-foreground">{Number.isFinite(total) ? total : 0}</strong> product{total === 1 ? '' : 's'}
          {recommendationMode ? <Badge className="ml-2" variant="secondary">Personalized</Badge> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={loading || safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-muted-foreground">{safePage} / {pageCount}</span>
          <Button variant="outline" size="sm" disabled={loading || safePage >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3 pt-4">
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : products.length === 0 ? (
        <SpEmptyState
          icon={Package}
          title="No products found"
          description="Try a different search or category, or start from a BOQ upload."
          action={<Button onClick={() => navigate('/boq-normalize')}>Upload BOQ</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => {
            const imgs = imageArray(product);
            const price = formatPrice(product?.price, product?.unit);
            const pid = String(product?.id || '');
            const inStock = Number(product?.stock) > 0;
            const hasEligibleSupplier = Number(product?.supplierCount || 0) > 0;
            const moq = Number(product?.min_order_quantity);

            return (
              <article className="pd-card flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md" key={product.id || `${product.name}-${product.category}`}>
                <div className="pd-card__image">
                  {imgs.length > 0 ? (
                    <ProductImageCarousel images={imgs} alt={product.name} height={180} rounded={10} stopPropagation />
                  ) : (
                    <div className="pd-card__no-image">
                      <ImageOff size={36} />
                      <span>No image</span>
                    </div>
                  )}
                  {product.category && (
                    <span className="pd-card__category-badge">{product.category}</span>
                  )}
                </div>

                <div className="pd-card__body">
                  <div className="pd-card__header">
                    <h3 className="pd-card__name">{product.name || 'Unnamed Product'}</h3>
                    {product.brand && <span className="pd-card__brand">{product.brand}</span>}
                  </div>

                  <RatingStars rating={product.average_rating} reviews={product.total_reviews} />

                  <SpecBadges specifications={product.specifications} />
                  <TagList tags={product.tags} />

                  <div className="pd-card__details">
                    {price && <span className="pd-card__price">{price}</span>}
                    {!price && <span className="pd-card__price pd-card__price--na">Price on request</span>}

                    <div className="pd-card__meta-row">
                      {product.unit && <span className="pd-card__meta-item">Unit: {product.unit}</span>}
                      {moq > 1 && <span className="pd-card__meta-item">MOQ: {moq}</span>}
                      {product.stock != null && (
                        <span className={`pd-card__stock ${inStock ? 'pd-card__stock--in' : 'pd-card__stock--out'}`}>
                          {inStock ? `${product.stock} in stock` : 'Out of stock'}
                        </span>
                      )}
                    </div>

                    {product.location && (
                      <div className="pd-card__location">
                        <MapPin size={13} /> {product.location}
                      </div>
                    )}

                    {product.barcode && (
                      <span className="pd-card__barcode">Barcode: {product.barcode}</span>
                    )}
                  </div>
                </div>

                <div className="pd-card__footer">
                  <div className="pd-card__suppliers">
                    {Number.isFinite(Number(product?.supplierCount)) && (
                      <>
                        <Users size={14} />
                        <span>{Number(product.supplierCount)} supplier{Number(product.supplierCount) === 1 ? '' : 's'}</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="pd-card__cart-btn"
                    onClick={() => openProjectPicker(product)}
                    disabled={Boolean(cartBusyByProductId[pid]) || !hasEligibleSupplier}
                    title={!hasEligibleSupplier ? 'No eligible supplier is currently listing this product' : undefined}
                  >
                    {cartAddedByProductId[pid] ? (
                      <><Check size={16} /> Added</>
                    ) : !hasEligibleSupplier ? (
                      <>No suppliers</>
                    ) : (
                      <><ShoppingCart size={16} /> Add to Cart</>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Dialog open={projectPickerOpen} onOpenChange={setProjectPickerOpen}>
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
            <Button variant="outline" onClick={() => setProjectPickerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmAddToCart}>
              Add to cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SpPageLayout>
  );
};

export default ProductDiscovery;
