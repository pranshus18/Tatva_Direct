import db from '../services/db.js';

export const requireAdminPrivileges = async (req, res, next) => {
  try {
    const user = await db.findById('users', req.userId);
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@tatvadirect.com').toLowerCase();

    if (user && (String(user.email || '').toLowerCase() === adminEmail || user.user_type === 'admin')) {
      return next();
    }

    return res.status(403).json({
      status: 'error',
      message: 'Access denied. Admin privileges required.'
    });
  } catch (_error) {
    return res.status(500).json({
      status: 'error',
      message: 'Error checking admin privileges'
    });
  }
};
