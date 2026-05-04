import React from 'react';
import { Navigate } from 'react-router-dom';

const ServiceProviderRoute = ({ children, user }) => {
  // If user is not a service provider, redirect to their dashboard
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  
  if (user.userType !== 'service_provider') {
    // Redirect to appropriate dashboard based on user type
    if (user.userType === 'supplier') {
      return <Navigate to="/supplier-dashboard" replace />;
    } else if (user.userType === 'admin') {
      return <Navigate to="/admin-dashboard" replace />;
    } else {
      return <Navigate to="/dashboard" replace />;
    }
  }
  
  return children;
};

export default ServiceProviderRoute;
