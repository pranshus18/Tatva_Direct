import { useEffect, useState } from 'react';
import { getApiUrl } from '../config/api';

export function useSupplierBrands() {
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
        const res = await fetch(getApiUrl('/api/supplier/brands'), {
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
  }, []);

  const brandNames = brands.map((b) => b.name).filter(Boolean);

  return { brands, brandNames, loading, error };
}
