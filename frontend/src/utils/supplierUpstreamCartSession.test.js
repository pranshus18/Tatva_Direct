import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  SUPPLIER_UPSTREAM_CART_RESUME_KEY,
  SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY,
  clearUpstreamCartClientProjectState,
  readUpstreamSessionProjectId,
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
});
