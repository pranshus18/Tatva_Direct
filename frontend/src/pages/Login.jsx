import React from 'react';
import { Navigate } from 'react-router-dom';

/** Legacy route — email/password login is admin-only at /admin-login. */
const Login = () => <Navigate to="/pm-auth" replace />;

export default Login;
