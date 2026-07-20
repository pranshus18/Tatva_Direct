import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isPmAuthenticated } from '../utils/pmAuthSession';

const PmAuthGate = ({ children }) => {
  const location = useLocation();

  if (!isPmAuthenticated()) {
    return <Navigate to="/pm-auth" replace state={{ from: location.pathname }} />;
  }

  return children;
};

export default PmAuthGate;
