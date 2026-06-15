import { useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import { dedupeBrandCatalogRows, dedupeBrandNames } from '../utils/supplierChainEntryValidation';

/**
 * @param {{ source?: 'profile' | 'catalog' }} [options]
 * - profile: brands declared + approved for this supplier (product forms)
 * - catalog: all admin-approved brands (Select yourself Step 1)
 */
export function useSupplierBrands({ source = 'profile' } = {}) {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const token = localStorage.getItem('token');
        const endpoint =
          source === 'catalog' ? '/api/supplier/brands/approved-catalog' : '/api/supplier/brands';
        const res = await fetch(getApiUrl(endpoint), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-cache'
        });
        const data = await res.json();
        if (!res.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to load brands');
        }
        if (!cancelled) {
          setBrands(Array.isArray(data.brands) ? data.brands : []);
        }
      } catch (e) {
        if (!cancelled) {
          setBrands([]);
          setError(e.message || 'Failed to load brands');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source]);

  const normalizedBrands = useMemo(
    () => (source === 'catalog' ? dedupeBrandCatalogRows(brands) : brands),
    [brands, source]
  );

  const brandNames = useMemo(
    () => dedupeBrandNames(brands.map((b) => b.name).filter(Boolean)),
    [brands]
  );

  return { brands: normalizedBrands, brandNames, loading, error };
}
