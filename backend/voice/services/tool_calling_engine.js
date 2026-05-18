import { ActionType } from '../core/routeTypes.js';
import { runTool } from '../voiceTools.js';
import { truncateForSpeech } from '../summarizeForVoice.js';
import { productCatalogService } from './product_catalog_service.js';
import { extractProductQuery } from '../lib/productQueryParser.js';

function safeParseSearch(raw) {
  if (typeof raw !== 'string') return raw;
  if (raw.startsWith('Search failed') || raw.startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      return { products: [], error: raw };
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { products: [], error: raw };
  }
}

/**
 * Structured tool execution — { action, slots } → backend APIs.
 */
export const toolCallingEngine = {
  async execute(toolCtx, action, slots = {}, utterance = '') {
    const tools = toolCtx.tools;
    const { client, memory } = toolCtx;

    switch (action) {
      case ActionType.ADD_TO_CART: {
        let product = productCatalogService.resolveProductFromSession(memory, utterance);
        let name = product?.name || slots.product_name || 'item';
        let productId = product?.id || slots.product_id;

        if (!productId && slots.query) {
          const found = await productCatalogService.search(client, {
            query: slots.query,
            limit: 1,
            memory
          });
          if (found.ok && found.products[0]) {
            productId = found.products[0].id;
            name = found.products[0].name;
          }
        }

        if (!productId) {
          const q = slots.query || extractProductQuery(utterance).query;
          return {
            ok: false,
            speech: q
              ? `I am not able to find the product "${q}". Search for it first, then say add to cart.`
              : 'I am not able to find the product. Search first, then say add to cart.'
          };
        }

        const raw = await tools.add_to_cart({
          product_id: productId,
          quantity: slots.quantity || 1
        });
        const ok =
          typeof raw === 'object' ||
          String(raw).includes('success') ||
          String(raw).includes('status');
        return { ok, speech: ok ? `Added ${name} to your cart.` : truncateForSpeech(String(raw)) };
      }

      case ActionType.REMOVE_FROM_CART:
        if (slots.clear_all) {
          await tools.remove_from_cart({ clear_all: true });
          return { ok: true, speech: 'Cart cleared.' };
        }
        return { ok: false, speech: 'Say clear cart, or remove by item name.' };

      case ActionType.OPEN_CART: {
        const raw = await tools.get_cart({});
        const data = safeParseSearch(raw);
        const items = data?.items || [];
        if (!items.length) return { ok: true, speech: 'Your cart is empty.' };
        const names = items.slice(0, 3).map((i) => `${i.name} × ${i.quantity || 1}`);
        const more = items.length > 3 ? ` and ${items.length - 3} more.` : '';
        return { ok: true, speech: `Cart has ${items.length} items: ${names.join(', ')}${more}` };
      }

      case ActionType.CLEAR_CART: {
        await tools.remove_from_cart({ clear_all: true });
        return { ok: true, speech: 'Cart cleared.' };
      }

      case ActionType.SEARCH_PRODUCTS: {
        const parsed = await productCatalogService.search(client, {
          query: slots.query || extractProductQuery(utterance).query,
          category: slots.category || extractProductQuery(utterance).category,
          limit: slots.limit || 5,
          memory
        });
        return {
          ok: parsed.ok,
          speech: productCatalogService.formatSearchSpeech(parsed, memory)
        };
      }

      case ActionType.GET_RECOMMENDATIONS: {
        const parsed = await productCatalogService.search(client, {
          query: slots.query || '',
          limit: slots.limit || 5,
          memory
        });
        return {
          ok: parsed.ok,
          speech: productCatalogService.formatSearchSpeech(parsed, memory)
        };
      }

      case ActionType.CHECKOUT:
      case ActionType.PLACE_ORDER: {
        const raw = await tools.create_order({
          payment_method: slots.payment_method || 'cod'
        });
        return { ok: true, speech: truncateForSpeech(String(raw)) };
      }

      case ActionType.TRACK_ORDER: {
        if (slots.order_id) {
          const raw = await tools.track_order({ order_id: slots.order_id });
          return { ok: true, speech: truncateForSpeech(String(raw)) };
        }
        const dash = await client.get('/api/dashboard/service-provider');
        if (!dash.ok) return { ok: false, speech: 'Could not load orders.' };
        const orders = (dash.data?.yourOrders || dash.data?.orders || []).slice(0, 3);
        if (!orders.length) return { ok: true, speech: 'You have no recent orders.' };
        const lines = orders.map((o, i) => `${i + 1}. ${o.order_number || o.id}, ${o.status || 'unknown'}`);
        return { ok: true, speech: `Recent orders: ${lines.join('. ')}` };
      }

      case ActionType.CANCEL_ORDER: {
        const raw = await tools.cancel_order({
          order_id: slots.order_id,
          reason: slots.reason || 'Voice cancellation'
        });
        return { ok: true, speech: truncateForSpeech(String(raw)) };
      }

      case ActionType.REORDER: {
        await tools.reorder_products({ order_id: slots.order_id });
        return { ok: true, speech: 'Items added from your previous order.' };
      }

      case ActionType.INVENTORY_CHECK: {
        if (!slots.product_id) {
          return { ok: false, speech: 'Say check stock for a product from your last search.' };
        }
        const raw = await tools.check_inventory({ product_id: slots.product_id });
        return { ok: true, speech: truncateForSpeech(String(raw)) };
      }

      case ActionType.ADDRESS_GET: {
        const raw = await tools.get_profile_addresses();
        return { ok: true, speech: truncateForSpeech(String(raw)) };
      }

      case ActionType.SELECT_PAYMENT: {
        const raw = await tools.select_payment_method({
          order_id: slots.order_id,
          method: slots.method || 'online'
        });
        return { ok: true, speech: truncateForSpeech(String(raw)) };
      }

      default:
        return { ok: false, speech: null };
    }
  },

  async runGeminiTool(toolCtx, name, args) {
    return runTool(toolCtx, name, args);
  }
};
