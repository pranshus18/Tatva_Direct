export function requireFinanceRole(req, res, next) {
  const role = req.user?.user_type;
  if (role === 'admin' || role === 'supplier') return next();
  return res.status(403).json({ status: 'error', message: 'Finance role required' });
}
