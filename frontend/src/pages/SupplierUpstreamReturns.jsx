import { Navigate, useSearchParams } from 'react-router-dom';

/** Legacy route — redirects to unified Returns page. */
export default function SupplierUpstreamReturns() {
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.set('tab', 'outgoing');
  return <Navigate to={`/supplier-returns?${next.toString()}`} replace />;
}
