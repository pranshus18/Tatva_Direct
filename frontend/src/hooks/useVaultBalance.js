import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchVaultHeaderBalance, resolveVaultBalance } from '../services/vaultService';
import { normalizeUserType } from '../utils/userType';

export function useVaultBalance(user) {
  const userType = normalizeUserType(user?.userType);
  const [state, setState] = useState({
    visible: false,
    loading: true,
    balance: null,
    linked: true,
    walletPath: userType === 'supplier' ? '/supplier-wallet' : '/wallet',
    message: ''
  });
  const mountedRef = useRef(true);

  const fetchBalance = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !user?.id) {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, loading: false, visible: false }));
      }
      return;
    }

    if (mountedRef.current) {
      setState((prev) => ({ ...prev, loading: true }));
    }

    try {
      const data = await fetchVaultHeaderBalance();
      if (!mountedRef.current) return;

      setState({
        visible: data.visible !== false,
        loading: false,
        balance: data.balance ?? null,
        linked: data.linked !== false,
        walletPath: data.vaultPath || data.walletPath || (userType === 'supplier' ? '/supplier-wallet' : '/wallet'),
        message: data.message || ''
      });
    } catch {
      if (!mountedRef.current) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        visible: userType === 'service_provider' || userType === 'supplier',
        linked: false
      }));
    }
  }, [user?.id, userType]);

  useEffect(() => {
    mountedRef.current = true;
    fetchBalance();
    const intervalId = window.setInterval(fetchBalance, 30000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(intervalId);
    };
  }, [fetchBalance]);

  const formattedBalance =
    state.balance === null || state.balance === undefined
      ? null
      : resolveVaultBalance({ balance: state.balance }).toLocaleString('en-IN', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        });

  return {
    ...state,
    formattedBalance,
    refresh: fetchBalance
  };
}
