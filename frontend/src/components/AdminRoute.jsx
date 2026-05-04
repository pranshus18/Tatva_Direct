import React from 'react';
import { Navigate } from 'react-router-dom';

const AdminRoute = ({ children, user, isAuthenticated }) => {
  // Check if user is authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Check if user is admin
  if (user?.userType !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return children;
};

export default AdminRoute;
