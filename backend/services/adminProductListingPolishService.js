import logger from '../utils/logger.js';

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

  if (selected === 'openai' && !openaiApiKey) return { error: 'OpenAI API key not configured.' };
  if (selected === 'gemini' && !geminiApiKey) return { error: 'Gemini API key not configured.' };
  if (selected === 'claude' && !anthropicApiKey) return { error: 'Claude API key not configured.' };

  return { provider: selected, openaiApiKey, geminiApiKey, anthropicApiKey };
}

function parseJsonFromAiText(rawText) {
  if (!rawText) return null;
  try {
    const cleaned = String(rawText).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : cleaned);
  } catch {
    return null;
  }
}

function parseGeminiText(data) {
  if (!data?.candidates || !Array.isArray(data.candidates)) return '';
  for (const candidate of data.candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;
    const text = parts.map((part) => part?.text || '').join('\n').trim();
    if (text) return text;
  }
  return '';
}

async function callGeminiOnce({ systemPrompt, userPrompt, geminiApiKey, model }) {
  const fetch = await getFetch();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json'
        }
      })
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }
  const data = await response.json();
  const text = parseGeminiText(data);
  if (!text) throw new Error('Gemini returned empty content');
  return text;
}

async function callGemini({ systemPrompt, userPrompt, geminiApiKey }) {
  const preferred = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const models = [...new Set([preferred, 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'])];
  let lastError = null;
  for (const model of models) {
    try {
      return await callGeminiOnce({ systemPrompt, userPrompt, geminiApiKey, model });
    } catch (error) {
      lastError = error;
      logger.warn(`adminProductListingPolish Gemini model ${model} failed:`, error?.message || error);
    }
  }
  throw lastError || new Error('All Gemini models failed');
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
      temperature: 0.25,
      max_tokens: 2000,
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
      max_tokens: 2000,
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

/**
 * Turn supplier free-text into a customer-ready product description.
 * Does not modify specifications — use the specification assistant for that.
 */
export async function polishSupplierListingWithAi({
  productName,
  category = '',
  supplierDescription = '',
  existingSpecifications = {},
  provider = 'auto',
  adminNotes = ''
}) {
  void existingSpecifications;

  const supplierText = String(supplierDescription || '').trim();
  if (!String(productName || '').trim()) {
    return { status: 'error', message: 'Product name is required' };
  }
  if (!supplierText) {
    return { status: 'error', message: 'Description text is required to polish the listing' };
  }

  const systemPrompt = `You are a B2B construction materials catalog editor.
Rewrite supplier-submitted product copy into professional customer-facing content.
Return ONLY valid JSON:
{
  "description": "<2-4 sentence polished product description for buyers>"
}
Rules:
1) Fix grammar, spelling, and unclear wording without inventing facts.
2) Description must be plain prose (no bullet lists, no markdown).
3) Do not return specification keys or values — description text only.
4) Do not include pricing, stock, or supplier contact details in the description.`;

  const userPrompt = `Product name: ${productName}
Category: ${category || 'Not specified'}
${adminNotes ? `Admin notes: ${adminNotes}\n` : ''}
Source description (may be supplier draft or admin draft — polish for buyers):
${supplierText}

Polish the description for buyers and return JSON with the description field only.`;

  try {
    const picked = pickProvider(provider);
    if (picked.error) {
      return { status: 'error', message: picked.error };
    }

    let aiText = '';
    if (picked.provider === 'gemini') {
      aiText = await callGemini({ systemPrompt, userPrompt, geminiApiKey: picked.geminiApiKey });
    } else if (picked.provider === 'openai') {
      aiText = await callOpenAi({ systemPrompt, userPrompt, openaiApiKey: picked.openaiApiKey });
    } else {
      aiText = await callClaude({ systemPrompt, userPrompt, anthropicApiKey: picked.anthropicApiKey });
    }

    const parsed = parseJsonFromAiText(aiText) || {};
    const polishedDescription = String(parsed.description || parsed.enhancedDescription || '').trim();

    if (!polishedDescription) {
      return {
        status: 'error',
        message: 'AI did not return a usable description. Try again or edit manually.'
      };
    }

    return {
      status: 'success',
      description: polishedDescription,
      provider: picked.provider
    };
  } catch (error) {
    logger.error('polishSupplierListingWithAi failed:', error);
    return {
      status: 'error',
      message: error.message || 'Failed to polish listing with AI'
    };
  }
}
