export const createAdminWriteNotifyMiddleware = ({ supabase, notifyAdminsForPortalAction, logError = console.error }) =>
  (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        const isWriteAction = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
        const isSuccess = body && body.status === 'success';
        if (isWriteAction && isSuccess && req.userId) {
          const action = `${req.method} ${req.originalUrl.split('?')[0]}`;
          setTimeout(() => {
            notifyAdminsForPortalAction({
              supabase,
              actorUserId: req.userId,
              action,
              metadata: {
                route: req.originalUrl.split('?')[0],
                method: req.method
              }
            });
          }, 0);
        }
      } catch (error) {
        logError('[Admin Notify] Middleware error:', error);
      }
      return originalJson(body);
    };
    next();
  };
