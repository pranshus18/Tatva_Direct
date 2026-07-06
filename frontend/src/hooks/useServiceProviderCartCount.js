import { useEffect, useState } from 'react';
import { subscribeServiceProviderCartCount } from '../utils/spCartBadge';

export function useServiceProviderCartCount() {
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => subscribeServiceProviderCartCount(setCartCount), []);

  return cartCount;
}
