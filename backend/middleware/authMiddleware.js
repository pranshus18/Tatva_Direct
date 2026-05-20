import jwt from 'jsonwebtoken';
import { supabase } from '../config/supabase.js';
import { shouldUpdateLastLogin } from '../utils/lastLoginThrottle.js';

const LAST_LOGIN_UPDATE_INTERVAL_MS =
  Number.parseInt(String(process.env.LAST_LOGIN_UPDATE_INTERVAL_MS || '600000'), 10) || 600000;

function normalizeUserType(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export const requireAuthentication = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'You are not logged in! Please log in to get access.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const { data: currentUser, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.id)
      .eq('is_active', true)
      .single();

    if (error || !currentUser) {
      return res.status(401).json({
        status: 'error',
        message: 'The user belonging to this token does no longer exist.'
      });
    }

    if (currentUser.password_changed_at) {
      const changedTimestamp = Math.floor(new Date(currentUser.password_changed_at).getTime() / 1000);
      if (decoded.iat < changedTimestamp) {
        return res.status(401).json({
          status: 'error',
          message: 'User recently changed password! Please log in again.'
        });
      }
    }

    if (shouldUpdateLastLogin(currentUser.last_login, LAST_LOGIN_UPDATE_INTERVAL_MS)) {
      await supabase
        .from('users')
        .update({ last_login: new Date().toISOString() })
        .eq('id', currentUser.id);
      currentUser.last_login = new Date().toISOString();
    }

    req.user = currentUser;
    req.userId = currentUser.id;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid token. Please log in again!'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        status: 'error',
        message: 'Your token has expired! Please log in again.'
      });
    }

    return res.status(500).json({
      status: 'error',
      message: 'Something went wrong during authentication'
    });
  }
};

export const requireServiceProvider = async (req, res, next) => {
  try {
    if (req.user?.user_type !== undefined) {
      if (normalizeUserType(req.user.user_type) === 'service_provider') {
        return next();
      }
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. This feature is only available for service providers.'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('user_type')
      .eq('id', req.userId)
      .single();

    if (error || !user) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. User not found.'
      });
    }

    const normalizedUserType = normalizeUserType(user.user_type);
    if (normalizedUserType === 'service_provider') {
      next();
    } else {
      res.status(403).json({
        status: 'error',
        message: 'Access denied. This feature is only available for service providers.'
      });
    }
  } catch (_error) {
    res.status(500).json({
      status: 'error',
      message: 'Error checking user permissions'
    });
  }
};

export const requireAdminRole = async (req, res, next) => {
  try {
    if (req.user?.user_type !== undefined) {
      if (req.user.user_type === 'admin') {
        return next();
      }
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. Admin access required.'
      });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('user_type')
      .eq('id', req.userId)
      .single();

    if (error || !user) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. User not found.'
      });
    }

    if (user.user_type === 'admin') {
      next();
    } else {
      res.status(403).json({
        status: 'error',
        message: 'Access denied. Admin access required.'
      });
    }
  } catch (_error) {
    res.status(500).json({
      status: 'error',
      message: 'Error checking user permissions'
    });
  }
};

// Backward-compatible aliases for existing route/controller references.
export const authenticateToken = requireAuthentication;
export const isServiceProvider = requireServiceProvider;
export const isAdmin = requireAdminRole;
