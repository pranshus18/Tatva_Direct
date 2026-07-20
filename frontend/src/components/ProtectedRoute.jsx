import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children, isAuthenticated }) => {
  if (isAuthenticated) return children;
  return <Navigate to="/pm-auth" replace />;
};

export default ProtectedRoute;