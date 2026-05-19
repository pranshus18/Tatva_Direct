import { extractProductQuery, parseCategoryFromText } from '../lib/productQueryParser.js';
import { expandSearchQueries } from '../lib/fuzzySearchQueries.js';
import { mergeRankedProducts } from '../../services/productDiscoveryFuzzyRank.js';
import {
  promptSearchSingle,
  promptSearchMultiple,
  promptSearchNotFound,
  promptSearchFuzzy
} from '../lib/voice_prompts.js';
import { enterDiscoveryFlow } from '../lib/voice_flow_mode.js';

const SEARCH_PATH = '/api/supplier/products/search';
const LOOKUP_PATH = '/api/supplier/products/lookup';

function mapProduct(p) {
  return {
    id: p.id,
    name: p.name || p.normalizedName || 'Product',
    category: p.category || '',
    brand: p.brand || '',
    unit: p.unit || ''
  };
}

function parseSearchResponse(result) {
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || 'Search failed',
      products: [],
      total: 0
    };
  }
  const data = result.data || {};
  const list = data.suggestions || data.products || [];
  const products = list.map(mapProduct);
  return {
    ok: true,
    products,
    total: data.total ?? products.length,
    recommendationMode: data.recommendationMode
  };
}

/**
 * Direct catalog access — calls backend search/lookup APIs (no Gemini).
 */
export const productCatalogService = {
  async search(client, { query = '', category = '', limit = 5, memory = null } = {}) {
    const q = String(query || '').trim();
    const params = {
      limit: Math.min(Math.max(Number(limit) || 5, 1), 10),
      page: 1
    };
    if (q) params.q = q;
    if (category) params.category = String(category).trim();

    const result = await client.get(SEARCH_PATH, params);
    const parsed = parseSearchResponse(result);

    if (memory && parsed.ok && parsed.products.length) {
      memory.setContext('last_search', {
        query: q,
        category,
        at: Date.now(),
        products: parsed.products
      });
    }

    return parsed;
  },

  async lookup(client, { name, category }) {
    const result = await client.get(LOOKUP_PATH, {
      name: String(name || '').trim(),
      category: String(category || '').trim()
    });
    if (!result.ok || !result.data?.found) {
      return { ok: false, product: null };
    }
    return { ok: true, product: mapProduct(result.data.product || result.data) };
  },

  async searchFromUtterance(client, text, memory) {
    const { query, category: catFromParse } = extractProductQuery(text);
    const category = catFromParse || parseCategoryFromText(text);
    const variants = expandSearchQueries(query);
    const queriesToTry = variants.length ? variants : [query];

    let merged = [];
    let lastParsed = { ok: true, products: [], total: 0 };

    for (const q of queriesToTry) {
      if (!String(q || '').trim()) continue;
      const parsed = await this.search(client, { query: q, category, limit: 8, memory: null });
      lastParsed = parsed;
      if (!parsed.ok) {
        lastParsed = parsed;
        break;
      }
      if (parsed.products?.length) {
        merged = mergeRankedProducts(
          merged,
          parsed.products.map((p, i) => ({
            ...p,
            matchScore: 1 - i * 0.02
          }))
        );
      }
    }

    if (lastParsed.ok && !merged.length && category) {
      for (const q of queriesToTry) {
        if (!String(q || '').trim()) continue;
        const parsed = await this.search(client, { query: q, category: '', limit: 8, memory: null });
        lastParsed = parsed;
        if (!parsed.ok) break;
        if (parsed.products?.length) {
          merged = mergeRankedProducts(
            merged,
            parsed.products.map((p, i) => ({ ...p, matchScore: 1 - i * 0.02 }))
          );
        }
      }
    }

    const products = merged.slice(0, 8);
    const parsed = {
      ok: lastParsed.ok,
      error: lastParsed.error,
      products,
      total: products.length || lastParsed.total || 0,
      recommendationMode: lastParsed.recommendationMode
    };

    if (memory && parsed.ok && products.length) {
      memory.setContext('last_search', {
        query,
        category,
        at: Date.now(),
        products
      });
    }

    return { ...parsed, query, category };
  },

  prepareAddToCartFollowUp(memory, parsed) {
    if (!memory || !parsed?.products?.length) return;

    enterDiscoveryFlow(memory);
    memory.setPendingAction({
      type: 'await_pick_product',
      summary: 'pick a product from search',
      payload: { products: parsed.products }
    });
  },

  formatSearchSpeech(parsed, memory = null) {
    const queryLabel = String(parsed.query || '').trim();

    if (!parsed.ok) {
      return parsed.error === 'Request timed out'
        ? 'Search timed out. Try a shorter product name.'
        : `I could not search right now. Please try again.`;
    }

    if (!parsed.products?.length) {
      memory?.setPendingAction?.(null);
      return promptSearchNotFound(queryLabel);
    }

    this.prepareAddToCartFollowUp(memory, parsed);

    const lines = parsed.products
      .slice(0, 5)
      .map((p, i) => {
        const bits = [p.name || 'Product'];
        if (p.brand) bits.push(p.brand);
        if (p.unit) bits.push(p.unit);
        return `Number ${i + 1}, ${bits.join(', ')}`;
      })
      .join('. ');
    const total = parsed.total ?? parsed.products.length;

    if (parsed.products.length === 1) {
      const name = parsed.products[0].name || 'this product';
      return promptSearchSingle(name);
    }

    const heard = String(parsed.query || '').trim();
    const first = String(parsed.products[0]?.name || '').toLowerCase();
    const fuzzyMatch =
      heard.length >= 3 &&
      first &&
      !first.includes(heard.slice(0, 4)) &&
      !heard.includes(first.slice(0, 4));

    if (fuzzyMatch) {
      return promptSearchFuzzy(heard, lines, total);
    }

    return promptSearchMultiple(lines, total);
  },

  resolveProductFromSession(memory, text) {
    const last = memory?.getContext('last_search');
    if (!last?.products?.length) return null;

    const t = String(text || '').toLowerCase();
    const idxMatch = t.match(/\b(?:first|1st|number\s*1|#1)\b/);
    if (idxMatch) return last.products[0];

    const numMatch = t.match(/\b(?:number|#)\s*(\d+)\b/);
    if (numMatch) {
      const i = Number.parseInt(numMatch[1], 10) - 1;
      if (i >= 0 && i < last.products.length) return last.products[i];
    }

    for (const p of last.products) {
      if (p.name && t.includes(String(p.name).toLowerCase().slice(0, 12))) return p;
    }
    return null;
  }
};
