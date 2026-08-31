import logger from '../utils/logger.js';
import { detectCategoryMismatch } from '../utils/categoryMismatch.js';
import { parseSpecificationsObject, sanitizeSpecifications } from './supplierCatalogHelpersService.js';
import { generateGeminiJsonText, parseJsonFromAiText } from './geminiGenerateService.js';
import {
  extractSpecsFromNarrativeDescription,
  isFilledSpecValue,
  mapSpecsOntoTemplateKeys,
  mergeMappedSpecs
} from '../utils/narrativeSpecExtraction.js';

async function getFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  const nodeFetch = await import('node-fetch');
  return nodeFetch.default;
}

function pickProvider(requested = 'auto') {
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

  let selected = String(requested || 'auto').toLowerCase();
  if (selected === 'auto') {
    if (geminiApiKey) selected = 'gemini';
    else if (openaiApiKey) selected = 'openai';
    else if (anthropicApiKey) selected = 'claude';
    else return { error: 'No AI API keys configured. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY.' };
  }

  if (selected === 'openai' && !openaiApiKey) {
    return { error: 'OpenAI API key not configured.' };
  }
  if (selected === 'gemini' && !geminiApiKey) {
    return { error: 'Gemini API key not configured.' };
  }
  if (selected === 'claude' && !anthropicApiKey) {
    return { error: 'Claude API key not configured.' };
  }

  return {
    provider: selected,
    openaiApiKey,
    geminiApiKey,
    anthropicApiKey
  };
}

async function callGemini({ systemPrompt, userPrompt, geminiApiKey }) {
  const { text } = await generateGeminiJsonText({
    geminiApiKey,
    systemInstruction: systemPrompt,
    userPrompt,
    temperature: 0.2,
    maxOutputTokens: 4096
  });
  return text;
}

async function callOpenAi({ systemPrompt, userPrompt, openaiApiKey }) {
  const fetch = await getFetch();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openaiApiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 1200,
      response_format: { type: 'json_object' }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function callClaude({ systemPrompt, userPrompt, anthropicApiKey }) {
  const fetch = await getFetch();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicApiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  const block = (data?.content || []).find((item) => item?.type === 'text');
  return block?.text?.trim() || '';
}

async function callAiProvider({ provider, systemPrompt, userPrompt, keys }) {
  const picked = pickProvider(provider);
  if (picked.error) throw new Error(picked.error);

  let aiText = '';
  if (picked.provider === 'gemini') {
    aiText = await callGemini({ systemPrompt, userPrompt, geminiApiKey: picked.geminiApiKey });
  } else if (picked.provider === 'openai') {
    aiText = await callOpenAi({ systemPrompt, userPrompt, openaiApiKey: picked.openaiApiKey });
  } else {
    aiText = await callClaude({ systemPrompt, userPrompt, anthropicApiKey: picked.anthropicApiKey });
  }

  const parsed = parseJsonFromAiText(aiText);
  const specs = parseSpecificationsObject(parsed?.specifications) || {};
  const { mapped, extras } = mapSpecsOntoTemplateKeys(specs, keys);
  return {
    specifications: mergeMappedSpecs(mapped, extras),
    provider: picked.provider
  };
}

/**
 * Fill admin-defined specification keys using values parsed from free-text description.
 */
export async function extractSpecificationValuesFromDescription({
  description,
  category = '',
  productName = '',
  existingSpecifications = {},
  provider = 'auto',
  blockOnCategoryMismatch = false
}) {
  const descriptionText = String(description || '').trim();
  if (!descriptionText) {
    return { status: 'error', message: 'description is required' };
  }

  const templateKeys = Object.keys(parseSpecificationsObject(existingSpecifications) || {});
  if (templateKeys.length === 0) {
    return {
      status: 'error',
      message: 'No specification keys available. Select a category/product first so admin template keys can load.'
    };
  }

  const categoryMismatchWarning = detectCategoryMismatch(
    category,
    descriptionText,
    productName
  );
  if (blockOnCategoryMismatch && categoryMismatchWarning) {
    return {
      status: 'warning',
      categoryMismatchWarning,
      message: categoryMismatchWarning
    };
  }

  const systemPrompt = `You extract product specification VALUES from ecommerce descriptions.
Return ONLY valid JSON:
{ "specifications": { "<key>": "<value or null>" } }

The description may be marketing prose OR explicit "Key: Value" lines. Both are valid.
Examples of prose you MUST parse:
- "Jaquar Continental vitreous china basin in white, 17.5 kg" → Brand, Series, Material, Color, Weight
- "Matt finish 20L emulsion covering 140 sq ft/L" → Finish, Volume/Capacity, Coverage

Rules:
1) Prefer the specification keys provided by the user (same meaning even if spelling/case differs: COLOR vs colour).
2) Infer clearly stated or strongly implied attributes (brand, color, series, material, weight, size, dimensions, capacity, finish).
3) Also include extra identifiable attributes that do not match a provided key.
4) Use null when a provided key is not supported by the text. Never invent facts.
5) Values must be concise strings. No markdown or commentary.`;

  const userPrompt = `Product name: ${productName || 'Not specified'}
Category: ${category || 'Not specified'}

Specification keys to fill:
${JSON.stringify(templateKeys, null, 2)}

Description:
${descriptionText}

Return JSON with values for the keys above and any other identifiable product details.`;

  const localSpecifications = extractSpecsFromNarrativeDescription({
    description: descriptionText,
    productName,
    templateKeys
  });

  const picked = pickProvider(provider);
  if (picked.error) {
    const filledCount = Object.values(localSpecifications).filter(isFilledSpecValue).length;
    return {
      status: 'success',
      specifications: localSpecifications,
      extractedCount: filledCount,
      provider: 'narrative',
      categoryMismatchWarning: categoryMismatchWarning || null
    };
  }

  try {
    const { specifications: aiSpecifications, provider: usedProvider } = await callAiProvider({
      provider,
      systemPrompt,
      userPrompt,
      keys: templateKeys
    });

    const specifications = mergeMappedSpecs(localSpecifications, aiSpecifications);
    const filledCount = Object.values(specifications).filter(isFilledSpecValue).length;

    return {
      status: 'success',
      specifications,
      extractedCount: filledCount,
      provider: usedProvider,
      categoryMismatchWarning: categoryMismatchWarning || null
    };
  } catch (error) {
    logger.error('extractSpecificationValuesFromDescription failed:', error);
    const filledCount = Object.values(localSpecifications).filter(isFilledSpecValue).length;
    // Local narrative parse always runs; empty result is a valid "nothing found" outcome.
    return {
      status: 'success',
      specifications: localSpecifications,
      extractedCount: filledCount,
      provider: 'narrative',
      categoryMismatchWarning: categoryMismatchWarning || null
    };
  }
}

/**
 * Extract specification key/value pairs from description when no admin template exists yet.
 */
export async function extractSpecificationPairsFromDescription({
  description,
  category = '',
  productName = '',
  provider = 'auto'
}) {
  const descriptionText = String(description || '').trim();
  if (!descriptionText) {
    return { status: 'error', message: 'description is required' };
  }

  const categoryMismatchWarning = detectCategoryMismatch(
    category,
    descriptionText,
    productName
  );
  const systemPrompt = `You extract product specification key-value pairs from descriptions.
The text may be normal product copy (sentences) or "Key: Value" lines.
Return ONLY valid JSON:
{ "specifications": { "Key Name": "value" } }
Use professional ecommerce specification names (Brand, Color, Material, Weight, Size, Capacity, Finish, Series, Dimensions).
Only include facts supported by the description. Do not invent values.`;

  const userPrompt = `Product name: ${productName || 'Not specified'}
Category: ${category || 'Not specified'}
Description:
${descriptionText}`;

  const localSpecifications = extractSpecsFromNarrativeDescription({
    description: descriptionText,
    productName
  });

  const picked = pickProvider(provider);
  if (picked.error) {
    const filledCount = Object.keys(localSpecifications).filter((key) =>
      isFilledSpecValue(localSpecifications[key])
    ).length;
    return {
      status: 'success',
      specifications: sanitizeSpecifications(localSpecifications),
      extractedCount: filledCount,
      provider: 'narrative',
      categoryMismatchWarning: categoryMismatchWarning || null
    };
  }

  try {
    let aiText = '';
    if (picked.provider === 'gemini') {
      aiText = await callGemini({ systemPrompt, userPrompt, geminiApiKey: picked.geminiApiKey });
    } else if (picked.provider === 'openai') {
      aiText = await callOpenAi({ systemPrompt, userPrompt, openaiApiKey: picked.openaiApiKey });
    } else {
      aiText = await callClaude({ systemPrompt, userPrompt, anthropicApiKey: picked.anthropicApiKey });
    }

    const parsed = parseJsonFromAiText(aiText);
    const aiSpecifications = sanitizeSpecifications(
      parseSpecificationsObject(parsed?.specifications) || {}
    );
    const specifications = sanitizeSpecifications(
      mergeMappedSpecs(localSpecifications, aiSpecifications)
    );
    const filledCount = Object.keys(specifications).filter((key) =>
      isFilledSpecValue(specifications[key])
    ).length;

    return {
      status: 'success',
      specifications,
      extractedCount: filledCount,
      provider: picked.provider,
      categoryMismatchWarning: categoryMismatchWarning || null
    };
  } catch (error) {
    logger.error('extractSpecificationPairsFromDescription failed:', error);
    const filledCount = Object.keys(localSpecifications).filter((key) =>
      isFilledSpecValue(localSpecifications[key])
    ).length;
    return {
      status: 'success',
      specifications: sanitizeSpecifications(localSpecifications),
      extractedCount: filledCount,
      provider: 'narrative',
      categoryMismatchWarning: categoryMismatchWarning || null
    };
  }
}
