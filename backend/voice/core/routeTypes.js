/** Amazon-style routing: FAST bypasses Gemini+RAG; SMART uses RAG+Gemini only when needed. */

export const RouteType = {
  FAST: 'fast',
  SMART: 'smart',
  CONFIRM: 'confirm',
  GREETING: 'greeting'
};

export const ActionType = {
  ADD_TO_CART: 'add_to_cart',
  REMOVE_FROM_CART: 'remove_from_cart',
  UPDATE_CART: 'update_cart',
  OPEN_CART: 'open_cart',
  CLEAR_CART: 'clear_cart',
  PLACE_ORDER: 'place_order',
  CHECKOUT: 'checkout',
  SELECT_PAYMENT: 'select_payment_method',
  TRACK_ORDER: 'track_order',
  CANCEL_ORDER: 'cancel_order',
  REORDER: 'reorder_previous_item',
  INVENTORY_CHECK: 'inventory_check',
  ADDRESS_GET: 'address_get',
  ADDRESS_UPDATE: 'address_update',
  SEARCH_PRODUCTS: 'search_products',
  GET_RECOMMENDATIONS: 'get_recommendations',
  SUPPORT_RAG: 'support_rag',
  COMPARE_PRODUCTS: 'compare_products',
  PRODUCT_EXPLAIN: 'product_explain',
  CONVERSATIONAL: 'conversational',
  UNKNOWN: 'unknown'
};
