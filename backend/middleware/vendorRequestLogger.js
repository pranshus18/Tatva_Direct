export function vendorRequestLogger(req, res, next) {
  console.log(`\n[REQUEST] ${req.method} ${req.originalUrl}`);
  console.log('[REQUEST] Headers:', {
    authorization: req.headers.authorization ? 'Present' : 'Missing',
    'content-type': req.headers['content-type']
  });

  if (req.method === 'POST' && req.body) {
    console.log('[REQUEST] Body keys:', Object.keys(req.body));
    if (req.body.items) {
      console.log(`[REQUEST] Items count: ${req.body.items.length}`);
      console.log(
        '[REQUEST] Sample item:',
        req.body.items[0]
          ? {
              id: req.body.items[0].id,
              normalizedName: req.body.items[0].normalizedName,
              productId: req.body.items[0].productId
            }
          : 'No items'
      );
    }
  }

  next();
}
