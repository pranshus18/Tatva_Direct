import React from 'react';
import { Navigate } from 'react-router-dom';
import { normalizeUserType } from '../utils/userType';

const SupplierRoute = ({ children, user }) => {
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const userType = normalizeUserType(user.userType);
  if (userType !== 'supplier') {
    if (userType === 'service_provider') {
      return <Navigate to="/dashboard" replace />;
    }
    if (userType === 'admin') {
      return <Navigate to="/admin-dashboard" replace />;
    }
    return <Navigate to="/login" replace />;
  }

  return children;
};

export default SupplierRoute;
