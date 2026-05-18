/**
 * REST paths used by the integrated voice commerce stack (Node + browser).
 */

export const VOICE_API_PATHS = {
  health: '/api/voice/health',
  productAvailability: (productId) => `/api/voice/products/${productId}/availability`,
  searchProducts: '/api/supplier/products/search',
  cart: '/api/po/cart',
  cartDiscoveryItem: '/api/po/cart/discovery-item',
  cartItemQuantity: (itemId) => `/api/po/cart/items/${itemId}/quantity`,
  poGroup: '/api/po/group',
  poCreate: '/api/po/create',
  poCancel: (orderId) => `/api/po/${encodeURIComponent(orderId)}/cancel`,
  vendorRank: '/api/vendors/rank',
  dashboard: '/api/dashboard/service-provider',
  orderDetail: (orderId) => `/api/dashboard/service-provider/orders/${encodeURIComponent(orderId)}`,
  profile: '/api/profile',
  razorpayCreate: (orderId) => `/api/payments/orders/${orderId}/razorpay/create`,
  bankTransferRequest: (orderId) => `/api/payments/orders/${orderId}/bank-transfer/request`
};

export function getVoiceWebSocketPath() {
  return '/api/voice/ws';
}
