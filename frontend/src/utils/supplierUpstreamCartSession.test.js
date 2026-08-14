import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  SUPPLIER_UPSTREAM_CART_RESUME_KEY,
  SUPPLIER_UPSTREAM_CART_SYNC_KEY,
  SUPPLIER_UPSTREAM_CART_UPDATED_EVENT,
  SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY,
  applyLiveCartQuantitiesToMap,
  clearUpstreamCartClientProjectState,
  emitSupplierCartUpdated,
  readUpstreamSessionProjectId,
  resolveUpstreamProjectCartName,
  subscribeSupplierCartUpdated,
  writeUpstreamSessionProjectId
} from './supplierUpstreamCartSession';

describe('supplierUpstreamCartSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('clears remembered project and resume draft after cart clear', () => {
    writeUpstreamSessionProjectId('proj-old');
    localStorage.setItem(
      SUPPLIER_UPSTREAM_CART_RESUME_KEY,
      JSON.stringify({ projectId: 'proj-old', selectedMine: { a: 2 } })
    );

    clearUpstreamCartClientProjectState();

    expect(readUpstreamSessionProjectId()).toBe('');
    expect(sessionStorage.getItem(SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY)).toBeNull();
    expect(localStorage.getItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY)).toBeNull();
  });

  it('keeps project names free of auto-inserted dispatch-looking dates', () => {
    expect(resolveUpstreamProjectCartName('Project 07/August/26')).toBe('Supplier Project');
    expect(resolveUpstreamProjectCartName('')).toBe('Supplier Project');
    expect(resolveUpstreamProjectCartName('July restock')).toBe('July restock');
  });

  it('copies live cart quantities into the upstream draft when cart qty changes', () => {
    const next = applyLiveCartQuantitiesToMap({ a: 2 }, { a: 2 }, { a: 5, b: 1 });
    expect(next).toEqual({ a: 5 });
  });

  it('does not copy saved cart quantities into an empty draft on first hydrate', () => {
    const draft = {};
    const next = applyLiveCartQuantitiesToMap(draft, {}, { a: 3, b: 1 });
    expect(next).toBe(draft);
    expect(next).toEqual({});
  });

  it('does not overwrite a local draft when the saved cart quantity is unchanged', () => {
    const draft = { a: 3 };
    const next = applyLiveCartQuantitiesToMap(draft, { a: 2 }, { a: 2 });
    expect(next).toBe(draft);
    expect(next).toEqual({ a: 3 });
  });

  it('can limit live cart copies to keys already on the map', () => {
    const next = applyLiveCartQuantitiesToMap(
      { a: 2 },
      { a: 2 },
      { a: 5, b: 9 },
      { onlyExistingKeys: true }
    );
    expect(next).toEqual({ a: 5 });
  });

  it('notifies other listeners and writes a cross-tab sync stamp', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeSupplierCartUpdated(handler, { debounceMs: 0, includeFocus: false });
    emitSupplierCartUpdated();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SUPPLIER_UPSTREAM_CART_SYNC_KEY)).toBeTruthy();
    unsubscribe();
  });

  it('re-runs the handler when another tab writes the cart sync key', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeSupplierCartUpdated(handler, {
      debounceMs: 0,
      includeSameWindow: false,
      includeFocus: false
    });
    window.dispatchEvent(
      new StorageEvent('storage', { key: SUPPLIER_UPSTREAM_CART_SYNC_KEY, newValue: '1' })
    );
    expect(handler).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event(SUPPLIER_UPSTREAM_CART_UPDATED_EVENT));
    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
