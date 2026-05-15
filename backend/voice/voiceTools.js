import { InternalApiClient } from './internalApiClient.js';

function flattenCartItems(draft) {
  const items = [];
  const groups = draft?.boqGroups || [];
  for (const g of groups) {
    for (const it of g.items || []) items.push(it);
  }
  return items;
}

async function autoSelectVendors(client, items) {
  const rank = await client.post('/api/vendors/rank', {
    items,
    boqId: null,
    _timestamp: Date.now(),
    _random: Math.random()
  });
  if (!rank.ok) return {};
  const itemVendors = rank.data?.itemVendors || rank.data?.vendors || {};
  const selected = {};
  for (const item of items) {
    const iid = String(item.id);
    const vendors = itemVendors[iid] || itemVendors[item.id] || [];
    if (Array.isArray(vendors) && vendors.length) {
      const top = vendors[0];
      const token = top.supplierProductId || top.id || top.vendorId;
      if (token) {
        selected[iid] = String(token);
        if (item.productId) selected[String(item.productId)] = String(token);
      }
    }
  }
  return selected;
}

export function createVoiceToolContext(token, memory) {
  const client = new InternalApiClient(token);

  async function executePlaceOrder(payload) {
    const items = payload.items || [];
    const selected = payload.selected_vendors || payload.selectedVendors || {};
    const paymentMethod = payload.payment_method || payload.paymentMethod || 'cod';

    const groupRes = await client.post('/api/po/group', {
      items,
      selectedVendors: selected,
      substitutions: []
    });
    if (!groupRes.ok) return `Could not group order: ${groupRes.error}`;
    const poGroups = groupRes.data?.poGroups || groupRes.data?.groups || [];
    if (!poGroups.length) return 'No purchase order groups could be created.';

    const createRes = await client.post('/api/po/create', {
      poGroups,
      paymentMethod,
      deliveryDestination: 'shipping'
    });
    if (!createRes.ok) return `Order creation failed: ${createRes.error}`;
    return JSON.stringify(createRes.data);
  }

  async function executeCancelOrder(payload) {
    const oid = payload.order_id || payload.orderId;
    const reason = payload.reason || 'Voice cancellation';
    const res = await client.post(`/api/po/${encodeURIComponent(oid)}/cancel`, { reason });
    if (!res.ok) return `Cancel failed: ${res.error}`;
    return JSON.stringify(res.data);
  }

  async function executeOnlinePayment(orderId) {
    const res = await client.post(`/api/payments/orders/${orderId}/razorpay/create`, {});
    if (!res.ok) return `Payment setup failed: ${res.error}`;
    return `Online payment intent created. Complete payment in the app if prompted. ${JSON.stringify(res.data).slice(0, 400)}`;
  }

  const tools = {
    async search_products({ query = '', category = '', limit = 5 }) {
      const params = { limit: Math.min(Math.max(Number(limit) || 5, 1), 20), page: 1 };
      if (String(query).trim()) params.q = String(query).trim();
      if (String(category).trim()) params.category = String(category).trim();
      const result = await client.get('/api/supplier/products/search', params);
      if (!result.ok) return `Search failed: ${result.error}`;
      const items = (result.data?.suggestions || []).slice(0, limit).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        brand: p.brand
      }));
      return JSON.stringify({ total: result.data?.total, products: items });
    },

    async get_recommendations({ limit = 5 }) {
      return tools.search_products({ query: '', category: '', limit });
    },

    async check_inventory({ product_id: productId }) {
      const result = await client.get(`/api/voice/products/${productId}/availability`);
      if (!result.ok) return `Inventory check failed: ${result.error}`;
      return JSON.stringify(result.data);
    },

    async get_cart() {
      const result = await client.get('/api/po/cart');
      if (!result.ok) return `Could not load cart: ${result.error}`;
      const draft = result.data?.cart?.draft || {};
      const items = flattenCartItems(draft).map((it) => ({
        id: it.id,
        name: it.name || it.normalizedName,
        quantity: it.quantity,
        productId: it.productId
      }));
      memory.setContext('last_cart_items', items);
      return JSON.stringify({ itemCount: items.length, items });
    },

    async add_to_cart({ product_id: productId, quantity = 1 }) {
      const result = await client.post('/api/po/cart/discovery-item', {
        productId,
        quantity: Math.max(1, Math.floor(Number(quantity) || 1))
      });
      if (!result.ok) return `Add to cart failed: ${result.error}`;
      return JSON.stringify(result.data);
    },

    async update_cart({ item_id: itemId, quantity }) {
      const result = await client.patch(`/api/po/cart/items/${itemId}/quantity`, {
        quantity: Math.max(1, Math.floor(Number(quantity) || 1))
      });
      if (!result.ok) return `Update failed: ${result.error}`;
      return JSON.stringify(result.data);
    },

    async remove_from_cart({ item_id: itemId = '', clear_all: clearAll = false }) {
      if (clearAll) {
        const result = await client.delete('/api/po/cart');
        if (!result.ok) return `Clear cart failed: ${result.error}`;
        return JSON.stringify(result.data);
      }
      const cartRes = await client.get('/api/po/cart');
      if (!cartRes.ok) return `Could not load cart: ${cartRes.error}`;
      const draft = cartRes.data?.cart?.draft || {};
      const groups = [...(draft.boqGroups || [])];
      let found = false;
      for (const g of groups) {
        const arr = g.items || [];
        const next = arr.filter((x) => String(x.id) !== String(itemId));
        if (next.length !== arr.length) {
          found = true;
          g.items = next;
        }
      }
      if (!found) return 'Cart item not found.';
      draft.boqGroups = groups.filter((g) => (g.items || []).length);
      const result = await client.put('/api/po/cart', {
        boqGroups: draft.boqGroups,
        selectedVendors: draft.selectedVendors || {},
        substitutions: draft.substitutions || [],
        items: draft.items || []
      });
      if (!result.ok) return `Remove failed: ${result.error}`;
      return JSON.stringify({ status: 'success', message: 'Item removed' });
    },

    async track_order({ order_id: orderId }) {
      const result = await client.get(
        `/api/dashboard/service-provider/orders/${encodeURIComponent(orderId)}`
      );
      if (!result.ok) {
        const dash = await client.get('/api/dashboard/service-provider');
        if (dash.ok) {
          const orders = (dash.data?.yourOrders || dash.data?.orders || []).slice(0, 5);
          return JSON.stringify({ hint: 'Order not found', recentOrders: orders });
        }
        return `Track failed: ${result.error}`;
      }
      return JSON.stringify(result.data);
    },

    async cancel_order({ order_id: orderId, reason = 'Cancelled via voice assistant' }) {
      memory.setPendingAction({
        type: 'cancel_order',
        summary: `cancel order ${orderId}`,
        payload: { order_id: orderId, reason }
      });
      return `I can cancel order ${orderId}. Say yes to confirm, or no to cancel.`;
    },

    async reorder_products({ order_id: orderId }) {
      const detail = await client.get(
        `/api/dashboard/service-provider/orders/${encodeURIComponent(orderId)}`
      );
      if (!detail.ok) return `Could not load order: ${detail.error}`;
      const order = detail.data?.order || detail.data;
      const lines = order.order_items || order.items || [];
      let added = 0;
      for (const line of lines) {
        const pid = line.product?.id || line.product_id;
        if (!pid) continue;
        const res = await client.post('/api/po/cart/discovery-item', {
          productId: pid,
          quantity: Math.max(1, parseInt(line.quantity, 10) || 1)
        });
        if (res.ok) added += 1;
      }
      return JSON.stringify({ status: 'success', added });
    },

    async create_order({ payment_method: paymentMethod = 'cod' }) {
      const cartRes = await client.get('/api/po/cart');
      if (!cartRes.ok) return `Could not load cart: ${cartRes.error}`;
      const items = flattenCartItems(cartRes.data?.cart?.draft || {});
      if (!items.length) return 'Your cart is empty. Add products before checkout.';

      let selected = memory.getContext('selected_vendors') || {};
      if (!Object.keys(selected).length) {
        selected = await autoSelectVendors(client, items);
        memory.setContext('selected_vendors', selected);
      }

      memory.setPendingAction({
        type: 'place_order',
        summary: 'place your order',
        payload: { items, selected_vendors: selected, payment_method: paymentMethod }
      });
      return `Ready to place order with ${items.length} items (${paymentMethod}). Say yes to confirm, or no to cancel.`;
    },

    async select_payment_method({ order_id: orderId, method = 'online' }) {
      const m = String(method).toLowerCase();
      if (m === 'online') {
        memory.setPendingAction({
          type: 'payment',
          summary: `start online payment for order ${orderId}`,
          payload: { order_id: orderId, method: 'online' }
        });
        return `I can start online payment for order ${orderId}. Say yes to confirm, or no to cancel.`;
      }
      if (m === 'bank_transfer') {
        const res = await client.post(
          `/api/payments/orders/${orderId}/bank-transfer/request`,
          {}
        );
        if (!res.ok) return `Bank transfer request failed: ${res.error}`;
        return JSON.stringify(res.data);
      }
      return JSON.stringify({ status: 'success', message: `Payment method noted: ${m}` });
    },

    async get_profile_addresses() {
      const result = await client.get('/api/profile');
      if (!result.ok) return `Could not load profile: ${result.error}`;
      const user = result.data?.user || result.data;
      return JSON.stringify({
        address: user.address,
        billingAddresses: user.profile?.billingAddresses
      });
    },

    async update_shipping_address({ line1, city, state, pincode, country = 'India' }) {
      const result = await client.put('/api/profile', {
        address: { line1, city, state, pincode, country }
      });
      if (!result.ok) return `Address update failed: ${result.error}`;
      return JSON.stringify({ status: 'success', message: 'Shipping address updated' });
    },

    async answer_support_question({ question }) {
      const { retrieveSupportContext } = await import('./supportRetriever.js');
      const chunks = retrieveSupportContext(question, 4);
      if (!chunks.length) return 'No policy information loaded yet. Please contact support.';
      return JSON.stringify({ sources: chunks.length, context: chunks });
    }
  };

  return {
    client,
    tools,
    executePlaceOrder,
    executeCancelOrder,
    executeOnlinePayment
  };
}

export const GEMINI_TOOL_DECLARATIONS = [
  {
    name: 'search_products',
    description: 'Search product catalog',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'get_recommendations',
    description: 'Personalized product recommendations',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } }
  },
  {
    name: 'check_inventory',
    description: 'Check stock for a product UUID',
    parameters: {
      type: 'object',
      properties: { product_id: { type: 'string' } },
      required: ['product_id']
    }
  },
  {
    name: 'get_cart',
    description: 'Get current cart',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'add_to_cart',
    description: 'Add product to cart',
    parameters: {
      type: 'object',
      properties: {
        product_id: { type: 'string' },
        quantity: { type: 'number' }
      },
      required: ['product_id']
    }
  },
  {
    name: 'update_cart',
    description: 'Update cart line quantity',
    parameters: {
      type: 'object',
      properties: { item_id: { type: 'string' }, quantity: { type: 'number' } },
      required: ['item_id', 'quantity']
    }
  },
  {
    name: 'remove_from_cart',
    description: 'Remove item or clear cart',
    parameters: {
      type: 'object',
      properties: { item_id: { type: 'string' }, clear_all: { type: 'boolean' } }
    }
  },
  {
    name: 'create_order',
    description: 'Start checkout (requires confirmation)',
    parameters: {
      type: 'object',
      properties: {
        payment_method: { type: 'string', description: 'cod, online, bank_transfer, credit' }
      }
    }
  },
  {
    name: 'track_order',
    description: 'Track order by id or order number',
    parameters: {
      type: 'object',
      properties: { order_id: { type: 'string' } },
      required: ['order_id']
    }
  },
  {
    name: 'cancel_order',
    description: 'Request order cancel (requires confirmation)',
    parameters: {
      type: 'object',
      properties: { order_id: { type: 'string' }, reason: { type: 'string' } },
      required: ['order_id']
    }
  },
  {
    name: 'reorder_products',
    description: 'Re-add items from a past order to cart',
    parameters: {
      type: 'object',
      properties: { order_id: { type: 'string' } },
      required: ['order_id']
    }
  },
  {
    name: 'select_payment_method',
    description: 'Choose payment method for an order',
    parameters: {
      type: 'object',
      properties: { order_id: { type: 'string' }, method: { type: 'string' } },
      required: ['order_id']
    }
  },
  {
    name: 'get_profile_addresses',
    description: 'Get shipping and billing addresses',
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'update_shipping_address',
    description: 'Update shipping address',
    parameters: {
      type: 'object',
      properties: {
        line1: { type: 'string' },
        city: { type: 'string' },
        state: { type: 'string' },
        pincode: { type: 'string' },
        country: { type: 'string' }
      },
      required: ['line1', 'city', 'state', 'pincode']
    }
  },
  {
    name: 'answer_support_question',
    description: 'FAQs, policies, refunds — not for cart or orders',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question']
    }
  }
];

export async function runTool(toolCtx, name, args) {
  const fn = toolCtx.tools[name];
  if (!fn) return `Unknown tool: ${name}`;
  try {
    return await fn(args || {});
  } catch (err) {
    return `Tool error: ${err.message}`;
  }
}
