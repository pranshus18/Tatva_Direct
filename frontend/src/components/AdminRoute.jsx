import React from 'react';
import { Navigate } from 'react-router-dom';
import { normalizeUserType } from '../utils/userType';

const AdminRoute = ({ children, user, isAuthenticated }) => {
  // Check if user is authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check if user is admin
  if (normalizeUserType(user?.userType) !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default AdminRoute;
