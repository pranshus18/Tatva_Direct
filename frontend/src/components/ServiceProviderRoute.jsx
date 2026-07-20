import React from 'react';
import { Navigate } from 'react-router-dom';
import { normalizeUserType } from '../utils/userType';

const ServiceProviderRoute = ({ children, user }) => {
  // If user is not a service provider, redirect to their dashboard
  if (!user) {
    return <Navigate to="/pm-auth" replace />;
  }

  const userType = normalizeUserType(user.userType);
  if (userType !== 'service_provider') {
    // Redirect to appropriate dashboard based on user type
    if (userType === 'supplier') {
      return <Navigate to="/supplier-dashboard" replace />;
    } else if (userType === 'admin') {
      return <Navigate to="/admin-dashboard" replace />;
    } else {
      return <Navigate to="/dashboard" replace />;
    }
  }
  
  return children;
};

export default ServiceProviderRoute;
