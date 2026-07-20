import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Truck, Briefcase, Loader2 } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { isSupplierRegistered } from '@/utils/portalRoles';
import { switchPortal, persistPortalAuthResult } from '@/services/portalService';

function runMenuAction(event, action) {
  event.preventDefault();
  action();
}

export function SupplierPortalMenuItem({ user, onPortalChange }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const supplierRegistered = isSupplierRegistered(user);

  const handleClick = async () => {
    if (loading) return;

    if (!supplierRegistered) {
      navigate('/register-supplier');
      return;
    }

    setLoading(true);
    try {
      const data = await switchPortal('supplier');
      const nextUser = persistPortalAuthResult(data);
      await onPortalChange?.(nextUser);
    } catch (error) {
      alert(error.message || 'Could not open supplier portal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenuItem
      disabled={loading}
      className="cursor-pointer"
      onSelect={(event) => runMenuAction(event, handleClick)}
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Truck className="mr-2 h-4 w-4" />
      )}
      {supplierRegistered ? 'Switch to Supplier Portal' : 'Register as Supplier'}
    </DropdownMenuItem>
  );
}

export function ServiceProviderPortalMenuItem({ user, onPortalChange }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await switchPortal('service_provider');
      const nextUser = persistPortalAuthResult(data);
      await onPortalChange?.(nextUser);
    } catch (error) {
      alert(error.message || 'Could not open service provider portal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenuItem
      disabled={loading}
      className="cursor-pointer"
      onSelect={(event) => runMenuAction(event, handleClick)}
    >
      {loading ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Briefcase className="mr-2 h-4 w-4" />
      )}
      Switch to Service Provider Portal
    </DropdownMenuItem>
  );
}
