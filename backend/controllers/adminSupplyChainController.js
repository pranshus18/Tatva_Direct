import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import {
  generateGeminiJsonText,
  parseJsonFromAiText
} from '../services/geminiGenerateService.js';
import { requireAdminPrivileges } from '../middleware/adminMiddleware.js';
import {
  createCategorySupplyChain,
  deleteCategorySupplyChainById,
  findCategorySupplyChainsByNameIlike,
  listCategorySupplyChainDefinitions,
  listCategorySupplyChainsMeta,
  listCategorySupplyChainsNameAndId,
  updateCategorySupplyChainById
} from '../repositories/categorySupplyChainsRepository.js';
import {
  adminSupplyChainDefinitionUpsertSchema,
  adminSupplyChainSuggestSchema
} from '../contracts/adminContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import {
  normalizeBrandKey,
  prepareSupplyChainStagesForSave
} from '../services/supplyChainSharedService.js';
import {
  getCanonicalBrandNormalizedName,
  pickCanonicalBrandDisplayName,
  resolveBrandRowForName
} from '../services/brandDedupService.js';

const router = express.Router();

const VALID_ROLES = ['manufacturer', 'stockist', 'regional_distributor', 'local_distributor', 'dealer', 'retailer'];
const ROLE_DEPTH = {
  manufacturer: 0,
  stockist: 1,
  regional_distributor: 2,
  local_distributor: 3,
  dealer: 4,
  retailer: 5
};

function normalizeBrandName(name) {
  return String(name || '').trim();
}
function escapeIlikeExact(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
function validateStages(stages) {
  return prepareSupplyChainStagesForSave(stages);
}
function stripMarkdownCodeFences(raw) {
  let t = String(raw).trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '');
    t = t.replace(/\s*```\s*$/i, '');
  }
  return t.trim();
}

function extractBalancedJsonObject(s) {
  const str = String(s);
  const start = str.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < str.length; i++) {
    const c = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }
  return null;
}
function parseGeminiSupplyChainJson(rawText) {
  const stripped = stripMarkdownCodeFences(rawText);
  if (!stripped) return { ok: false, error: 'empty_response' };
  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch {}
  const balanced = extractBalancedJsonObject(stripped);
  if (balanced) {
    try {
      return { ok: true, value: JSON.parse(balanced) };
    } catch {}
  }
  const greedy = stripped.match(/\{[\s\S]*\}/);
  if (greedy) {
    try {
      return { ok: true, value: JSON.parse(greedy[0]) };
    } catch {}
  }
  return { ok: false, error: 'parse_failed', preview: stripped.slice(0, 280) };
}

async function listBrandDefinitions(_req, res) {
  try {
    const { data: brands, error: bErr } = await supabase.from('brands').select('name').in('status', ['approved', 'pending']);
    if (bErr) console.warn('brands table:', bErr.message);
    const set = new Set();
    (brands || []).forEach((r) => {
      if (r?.name) set.add(String(r.name).trim());
    });
    const { data: defs } = await listCategorySupplyChainsMeta(supabase);
    (defs || []).forEach((d) => {
      const n = d.category_name && String(d.category_name).trim();
      if (!n) return;
      const exists = [...set].some((x) => x.toLowerCase() === n.toLowerCase());
      if (!exists) set.add(n);
    });
    const names = [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
    const withMeta = names.map((name) => {
      const def = (defs || []).find((d) => d.category_name && d.category_name.trim().toLowerCase() === name.toLowerCase());
      return { name, hasDefinition: !!def, definitionId: def?.id || null, updatedAt: def?.updated_at || null };
    });
    res.json({ status: 'success', categories: withMeta });
  } catch (e) {
    console.error('supply-chain brands:', e);
    res.status(500).json({ status: 'error', message: e.message || 'Failed to load brands' });
  }
}

router.get('/brands', authenticateToken, requireAdminPrivileges, listBrandDefinitions);
router.get('/categories', authenticateToken, requireAdminPrivileges, listBrandDefinitions);

router.get('/definitions', authenticateToken, requireAdminPrivileges, async (_req, res) => {
  try {
    const { data, error } = await listCategorySupplyChainDefinitions(supabase);
    if (error) {
      if (error.code === '42P01') {
        return res.status(503).json({
          status: 'error',
          message: 'Table category_supply_chains not found. Run migration migration_add_category_supply_chains.sql in Supabase.'
        });
      }
      throw error;
    }
    res.json({ status: 'success', definitions: data || [] });
  } catch (e) {
    console.error('supply-chain definitions:', e);
    res.status(500).json({ status: 'error', message: e.message || 'Failed to load definitions' });
  }
});

router.get('/definitions/by-name/:categoryName', authenticateToken, requireAdminPrivileges, async (req, res) => {
  try {
    const raw = decodeURIComponent(req.params.categoryName || '');
    const name = normalizeBrandName(raw);
    if (!name) return res.status(400).json({ status: 'error', message: 'brandName required' });
    const pattern = escapeIlikeExact(name);
    const { data, error } = await findCategorySupplyChainsByNameIlike(pattern, supabase);
    if (error) throw error;
    const row = (data || []).find((r) => r.category_name.trim().toLowerCase() === name.toLowerCase());
    if (!row) return res.json({ status: 'success', definition: null });
    res.json({ status: 'success', definition: row });
  } catch (e) {
    console.error('supply-chain definition get:', e);
    res.status(500).json({ status: 'error', message: e.message || 'Failed to load definition' });
  }
});

router.put('/definitions', authenticateToken, requireAdminPrivileges, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(adminSupplyChainDefinitionUpsertSchema, req.body || {});
    const { brandName, categoryName, stages, summary } = payloadInput;
    const brand = normalizeBrandName(brandName || categoryName);
    if (!brand) return res.status(400).json({ status: 'error', message: 'brandName is required' });
    const v = validateStages(stages || []);
    if (!v.ok) return res.status(400).json({ status: 'error', message: v.message });

    const payload = {
      category_name: brand,
      stages: v.stages,
      summary: typeof summary === 'string' ? summary.slice(0, 5000) : null,
      updated_by: req.userId,
      updated_at: new Date().toISOString()
    };
    if (payloadInput.markAsAiSuggested || payloadInput.aiSuggestedAt) {
      payload.ai_suggested_at = payloadInput.aiSuggestedAt || new Date().toISOString();
    }

    const { data: existingRows } = await listCategorySupplyChainsNameAndId(supabase);
    const existing = (existingRows || []).find(
      (r) => r.category_name && r.category_name.trim().toLowerCase() === brand.toLowerCase()
    );

    let row;
    if (existing) {
      const { data, error } = await updateCategorySupplyChainById(existing.id, payload, supabase);
      if (error) throw error;
      row = data;
    } else {
      const { data, error } = await createCategorySupplyChain(payload, supabase);
      if (error) throw error;
      row = data;
    }

    // Admin-defined chain should immediately unlock supplier portal gating for the brand.
    // Keep brands table in sync by ensuring this brand is approved.
    try {
      const nowIso = new Date().toISOString();
      const normalizedBrand = getCanonicalBrandNormalizedName(brand);
      if (normalizedBrand) {
        const { data: resolvedBrand, error: resolveErr } = await resolveBrandRowForName(brand, supabase);
        if (resolveErr) throw resolveErr;

        if (resolvedBrand?.id) {
          if (String(resolvedBrand.status || '').toLowerCase() !== 'approved') {
            await supabase
              .from('brands')
              .update({
                name: pickCanonicalBrandDisplayName(brand, resolvedBrand.name),
                normalized_name: normalizedBrand,
                status: 'approved',
                approved_by: req.userId,
                approved_at: nowIso,
                rejection_reason: null,
                updated_at: nowIso
              })
              .eq('id', resolvedBrand.id);
          }
        } else {
          await supabase.from('brands').insert({
            name: pickCanonicalBrandDisplayName(brand),
            normalized_name: normalizedBrand,
            status: 'approved',
            requested_by: req.userId,
            requested_at: nowIso,
            approved_by: req.userId,
            approved_at: nowIso,
            rejection_reason: null,
            created_at: nowIso,
            updated_at: nowIso
          });
        }
      }
    } catch (brandSyncErr) {
      console.error('[adminSupplyChain] brand approval sync failed:', brandSyncErr);
    }

    res.json({ status: 'success', definition: row });
  } catch (e) {
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    console.error('supply-chain upsert:', e);
    res.status(500).json({ status: 'error', message: e.message || 'Failed to save definition' });
  }
});

router.post('/suggest-gemini', authenticateToken, requireAdminPrivileges, async (req, res) => {
  try {
    const { brandName, categoryName, productName, extraContext } = parseWithSchema(
      adminSupplyChainSuggestSchema,
      req.body || {}
    );
    const brand = normalizeBrandName(brandName || categoryName);
    if (!brand) return res.status(400).json({ status: 'error', message: 'brandName is required' });

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return res.status(400).json({
        status: 'error',
        message: 'GEMINI_API_KEY is not configured. Add it to backend .env for AI suggestions.'
      });
    }

    const prompt = `You are a B2B supply chain expert for India (construction materials, industrial goods, FMCG where relevant).

Brand: "${brand}"
${productName ? `Example product (optional): "${String(productName).trim()}"` : ''}
${extraContext ? `Additional context from admin: ${String(extraContext).slice(0, 2000)}` : ''}

Goal: return the *typical* supply chain for this brand in India.
CRITICAL: Do NOT default to listing every role. Include a role ONLY if it commonly exists for this brand's market flow.
If unsure whether a role exists, OMIT it (prefer fewer stages over more).

Return ONLY valid JSON (no markdown). Use this shape (you may include "confidence" per stage; do not include other fields):
{
  "summary": "one or two sentences describing the typical flow for this brand in India",
  "stages": [
    { "role": "<one of the keys below>", "notes": "short optional note for this stage", "confidence": 0.0 }
  ]
}

Allowed "role" values (use only these strings, in upstream-to-downstream order — omit stages that do not apply):
- manufacturer
- stockist
- regional_distributor
- local_distributor
- dealer
- retailer

Rules:
- Order stages from manufacturer (upstream) toward retailer (downstream).
- Include only roles that typically exist for this brand's market flow.
- Do not invent custom role names.
- Keep notes under 120 characters each.
- Confidence is 0.0–1.0. If confidence < 0.6, do NOT include that stage at all.
- Typical stage count is 2–4. Use 5–6 only if this brand genuinely uses every intermediary.`;

    let aiText;
    let usedModel;
    try {
      ({ text: aiText, model: usedModel } = await generateGeminiJsonText({
        geminiApiKey,
        userPrompt: prompt,
        temperature: 0.35,
        maxOutputTokens: 4096
      }));
    } catch (geminiError) {
      console.error('Gemini suggest supply chain error:', geminiError);
      return res.status(502).json({
        status: 'error',
        message: geminiError.message || 'Gemini API request failed. Check GEMINI_API_KEY and GEMINI_MODEL.'
      });
    }

    const parsedResult = parseGeminiSupplyChainJson(aiText);
    const parsed =
      parseJsonFromAiText(aiText) ??
      (parsedResult.ok ? parsedResult.value : null);
    if (!parsed || typeof parsed !== 'object') {
      console.error('Gemini JSON parse failed:', parsedResult.preview || aiText.slice(0, 400), 'model:', usedModel);
      return res.status(502).json({
        status: 'error',
        message:
          'Could not parse AI response as JSON. Please try again — if it persists, set GEMINI_JSON_MODEL=gemini-2.5-flash in backend .env for structured tasks.'
      });
    }
    const stagesIn = Array.isArray(parsed.stages) ? parsed.stages : [];
    const normalized = stagesIn
      .map((s) => ({
        role: s?.role,
        notes: typeof s?.notes === 'string' ? s.notes : '',
        confidence: typeof s?.confidence === 'number' ? s.confidence : null
      }))
      .filter((s) => {
        if (!s.role || !VALID_ROLES.includes(s.role)) return false;
        if (typeof s.confidence === 'number' && s.confidence < 0.6) return false;
        return true;
      });
    normalized.sort((a, b) => ROLE_DEPTH[a.role] - ROLE_DEPTH[b.role]);
    const v = validateStages(normalized);
    if (!v.ok) {
      return res.status(502).json({
        status: 'error',
        message: `AI returned invalid stages: ${v.message}`,
        raw: parsed
      });
    }

    res.json({
      status: 'success',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      stages: v.stages,
      aiSuggestedAt: new Date().toISOString()
    });
  } catch (e) {
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    console.error('suggest-gemini:', e);
    res.status(500).json({ status: 'error', message: e.message || 'Suggestion failed' });
  }
});

router.delete('/definitions/:id', authenticateToken, requireAdminPrivileges, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ status: 'error', message: 'id required' });
    const { error } = await deleteCategorySupplyChainById(id, supabase);
    if (error) throw error;
    res.json({ status: 'success', message: 'Definition removed' });
  } catch (e) {
    console.error('supply-chain delete:', e);
    res.status(500).json({ status: 'error', message: e.message || 'Failed to delete' });
  }
});

export { router as adminSupplyChainRouter };
