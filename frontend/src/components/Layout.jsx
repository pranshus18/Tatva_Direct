import React from 'react';
import { normalizeUserType } from '../utils/userType';
import { VoiceSessionProvider } from '../voice/VoiceSessionContext.jsx';
import SpAppShell from './sp/SpAppShell';
import SupplierAppShell from './supplier/SupplierAppShell';
import AdminAppShell from './admin/AdminAppShell';

const Layout = ({ user, onLogout, onPortalChange, children }) => {
  const userType = normalizeUserType(user?.userType);
  const layoutToken = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  if (userType === 'service_provider') {
    const spBody = (
      <SpAppShell user={user} onLogout={onLogout} onPortalChange={onPortalChange} children={children} />
    );
    if (layoutToken) {
      return <VoiceSessionProvider token={layoutToken}>{spBody}</VoiceSessionProvider>;
    }
    return spBody;
  }

  if (userType === 'supplier') {
    return (
      <SupplierAppShell user={user} onLogout={onLogout} onPortalChange={onPortalChange} children={children} />
    );
  }

  if (userType === 'admin') {
    return <AdminAppShell user={user} onLogout={onLogout} children={children} />;
  }

  return null;
};

export default Layout;
