import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authFetch } from '../../config/api';
import { formatDateIST } from '../../utils/dateTime';
import { replaceSpWorkflowForSelectedBoq } from '../../utils/spWorkflow';
import { clearSupplierSelectScopeSession } from '../../constants/supplierSelectSession';
import { persistSupplierSelectBackOrigin } from '../../utils/supplierSelectBack';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { AlertCircle, CheckCircle, Users } from 'lucide-react';

export default function BoqDetailDialog({
  open,
  onOpenChange,
  boqId,
  boqName,
  boqStatus,
  supplierSelectOrigin = 'dashboard',
  supplierSelectReturnTo = '/dashboard'
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [items, setItems] = useState([]);
  const [project, setProject] = useState(null);
  const navigate = useNavigate();
  const requestSeqRef = useRef(0);
  const activeBoqIdRef = useRef(null);

  useEffect(() => {
    if (!open || !boqId) {
      requestSeqRef.current += 1;
      activeBoqIdRef.current = null;
      setItems([]);
      setProject(null);
      setLoadError('');
      setLoading(false);
      return;
    }

    const requestedBoqId = String(boqId);
    activeBoqIdRef.current = requestedBoqId;
    const requestSeq = ++requestSeqRef.current;

    // Always clear previous BOQ details immediately so a newly opened BOQ
    // never briefly shows the previous BOQ's line items.
    setItems([]);
    setProject(null);
    setLoadError('');
    setLoading(true);

    let cancelled = false;

    const fetchItems = async () => {
      try {
        const res = await authFetch(`/api/boq/${encodeURIComponent(requestedBoqId)}/items`, {
          timeoutMs: 12000
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled || requestSeq !== requestSeqRef.current) return;
        if (String(activeBoqIdRef.current || '') !== requestedBoqId) return;

        if (!res.ok || data.status !== 'success') {
          setLoadError(data.message || 'Could not load BOQ items.');
          setItems([]);
          setProject(null);
          return;
        }

        const nextItems = Array.isArray(data.items)
          ? data.items.map((item) => ({
              ...item,
              boqId: data.boqId || requestedBoqId
            }))
          : [];
        setItems(nextItems);
        setProject(data.project || null);
      } catch (error) {
        if (cancelled || requestSeq !== requestSeqRef.current) return;
        if (String(activeBoqIdRef.current || '') !== requestedBoqId) return;
        setLoadError(
          error?.name === 'AbortError'
            ? 'Loading BOQ items timed out. Please try again.'
            : error?.message || 'Could not load BOQ items.'
        );
        setItems([]);
        setProject(null);
      } finally {
        if (!cancelled && requestSeq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    };

    fetchItems();
    return () => {
      cancelled = true;
    };
  }, [open, boqId]);

  const handleContinueToSuppliers = () => {
    if (!boqId || loading) return;

    const selectedBoqId = String(boqId);
    const selectedItems = (Array.isArray(items) ? items : []).map((item) => ({
      ...item,
      boqId: item?.boqId || selectedBoqId
    }));

    // Replace any previously active BOQ workflow before navigating.
    replaceSpWorkflowForSelectedBoq({
      boqId: selectedBoqId,
      items: selectedItems,
      project
    });
    clearSupplierSelectScopeSession();

    onOpenChange?.(false);
    persistSupplierSelectBackOrigin(supplierSelectOrigin);
    navigate('/supplier-select', {
      replace: false,
      state: {
        fromBoqDetail: true,
        supplierSelectOrigin,
        supplierSelectReturnTo,
        supplierSelectBoqId: selectedBoqId,
        supplierSelectItems: selectedItems,
        supplierSelectBoqProject: project
      }
    });
  };

  const projectLocation =
    project?.location ||
    project?.siteLocation ||
    project?.address ||
    '';
  const requiredDate = project?.requiredDate || project?.required_date || '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        key={boqId || 'boq-detail-closed'}
        className="flex h-[min(90vh,720px)] w-[min(96vw,900px)] max-w-none flex-col gap-0 overflow-hidden rounded-lg border p-0 shadow-lg sm:left-1/2 sm:top-1/2 sm:h-auto sm:max-h-[90vh] sm:-translate-x-1/2 sm:-translate-y-1/2"
      >
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle>{boqName || 'BOQ details'}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1 text-sm text-muted-foreground">
              {boqStatus ? <p className="capitalize">Status: {boqStatus}</p> : null}
              {loading ? <p>Loading site and item details…</p> : null}
              {!loading && projectLocation ? <p>Dispatch location: {projectLocation}</p> : null}
              {!loading && requiredDate ? (
                <p>Expected dispatch date: {formatDateIST(requiredDate, requiredDate)}</p>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1 px-6 py-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : loadError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loadError}</span>
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">This BOQ has no line items.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">#</th>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Qty</th>
                    <th className="px-4 py-3 font-medium">Unit</th>
                    <th className="px-4 py-3 font-medium">Product Match</th>
                    <th className="px-4 py-3 font-medium">Supplier Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const label = item.normalizedName || item.rawName || '—';
                    const matched = Boolean(item.productId);
                    const availableSuppliers = Number(item.availableSuppliers || 0);
                    const hasAvailableSuppliers =
                      (item.isAvailable ?? availableSuppliers > 0) && availableSuppliers > 0;
                    const hasSupplierListing = Boolean(
                      item.supplierInfo || item.supplyChainLastSupplier || item.nearestSupplier
                    );
                    return (
                      <tr key={`${boqId}-${item.id || index}`} className="border-t">
                        <td className="px-4 py-3 text-muted-foreground">{index + 1}</td>
                        <td className="px-4 py-3 font-medium">{label}</td>
                        <td className="px-4 py-3">{item.quantity ?? '—'}</td>
                        <td className="px-4 py-3">{item.unit || '—'}</td>
                        <td className="px-4 py-3">
                          {matched ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle className="h-3.5 w-3.5" />
                              Product Matched
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Product Unmatched</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {hasAvailableSuppliers ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <Users className="h-3.5 w-3.5" />
                              {availableSuppliers} supplier{availableSuppliers === 1 ? '' : 's'} available
                            </span>
                          ) : hasSupplierListing ? (
                            <span className="text-amber-700">
                              Supplier listed, currently out of stock
                            </span>
                          ) : (
                            <span className="text-muted-foreground">No supplier available</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading items…' : `${items.length} item${items.length === 1 ? '' : 's'}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onOpenChange?.(false)}>
              Close
            </Button>
            <Button onClick={handleContinueToSuppliers} disabled={!boqId || loading || items.length === 0}>
              <Users className="h-4 w-4" />
              Find suppliers
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
