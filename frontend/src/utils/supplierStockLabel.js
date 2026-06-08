import { RUPEE_SYMBOL } from './formatRupee';

/** Supplier portal label for the logged-in supplier's on-hand quantity */
export const SUPPLIER_CURRENT_STOCK_LABEL = 'Current stock with you';

/** Supplier portal label for catalog / inventory unit amount (API field remains `price`) */
export const SUPPLIER_MRP_LABEL = 'MRP';

/** Form column: MRP with rupee symbol */
export const SUPPLIER_MRP_FIELD_LABEL = `${SUPPLIER_MRP_LABEL} (${RUPEE_SYMBOL})`;

/** Product_COV tier unit price (must not exceed catalog MRP) */
export const SUPPLIER_COV_PRICE_LABEL = 'COV price';

/** Form column: COV price with rupee symbol */
export const SUPPLIER_COV_PRICE_FIELD_LABEL = `${SUPPLIER_COV_PRICE_LABEL} (${RUPEE_SYMBOL})`;
