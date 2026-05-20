/** Supplier routes: productWrite */
import { registerSupplierProductCreateRoute } from './productWrite/createProductRoute.js';
import { registerSupplierProductUpdateRoute } from './productWrite/updateProductRoute.js';
import { registerSupplierProductDeleteRoute } from './productWrite/deleteProductRoute.js';

export function registerSupplierProductWriteRoutes(ctx) {
  registerSupplierProductCreateRoute(ctx);
  registerSupplierProductUpdateRoute(ctx);
  registerSupplierProductDeleteRoute(ctx);

}
