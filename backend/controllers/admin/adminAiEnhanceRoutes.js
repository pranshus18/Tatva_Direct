import {
  adminAiEnhanceSchema,
  adminAiGstSchema,
  adminAiPolishListingSchema
} from '../../contracts/adminContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { polishSupplierListingWithAi } from '../../services/adminProductListingPolishService.js';
import { detectCategoryMismatch } from '../../utils/categoryMismatch.js';

export function registerAdminAiEnhanceRoutes({ router, authenticateToken, isAdmin }) {
  // AI Fetch endpoint — generate specification keys only (not product description).
  router.post('/products/ai-enhance', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { productName, category, description, prompt: adminPrompt, provider = 'auto' } = parseWithSchema(
        adminAiEnhanceSchema,
        req.body || {}
      );
      const productDescription = (description || '').trim();
      const hasAdminPrompt = Boolean((adminPrompt || '').trim());
      const aiInstructions = hasAdminPrompt ? adminPrompt.trim() : productDescription;

      if (!productName) {
        return res.status(400).json({
          status: 'error',
          message: 'Product name is required'
        });
      }

      // Get API keys from environment variables
      const openaiApiKey = process.env.OPENAI_API_KEY;
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const claudeApiKey = process.env.CLAUDE_API_KEY;
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY || claudeApiKey;

      // Debug: Log which API keys are available (without exposing the actual keys)
      console.log('AI API Keys Status:', {
        hasOpenAI: !!openaiApiKey,
        hasGemini: !!geminiApiKey,
        hasClaude: !!anthropicApiKey,
        geminiKeyLength: geminiApiKey ? geminiApiKey.length : 0
      });

      // Determine which provider to use
      let selectedProvider = provider;
      let geminiApiKeyValue = geminiApiKey; // Store for error messages
      if (provider === 'auto') {
        // Auto-select: prioritize Gemini > OpenAI > Claude (Gemini is fast and cost-effective)
        if (geminiApiKey) selectedProvider = 'gemini';
        else if (openaiApiKey) selectedProvider = 'openai';
        else if (anthropicApiKey) selectedProvider = 'claude';
        else {
          return res.status(400).json({
            status: 'error',
            message: 'No AI API keys configured. Please set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY in environment variables.'
          });
        }
      }

      // Validate API key for selected provider
      if (selectedProvider === 'openai' && !openaiApiKey) {
        return res.status(400).json({
          status: 'error',
          message: 'OpenAI API key not configured. Please set OPENAI_API_KEY in environment variables.'
        });
      }
      if (selectedProvider === 'gemini' && !geminiApiKey) {
        return res.status(400).json({
          status: 'error',
          message: 'Gemini API key not configured. Please set GEMINI_API_KEY in environment variables.'
        });
      }
      if (selectedProvider === 'claude' && !anthropicApiKey) {
        return res.status(400).json({
          status: 'error',
          message: 'Claude API key not configured. Please set ANTHROPIC_API_KEY in environment variables.'
        });
      }

      // Initialize fetch
      let fetch;
      try {
        if (typeof globalThis.fetch === 'function') {
          fetch = globalThis.fetch;
        } else {
          const nodeFetch = await import('node-fetch');
          fetch = nodeFetch.default;
        }
      } catch (error) {
        console.error('Failed to load fetch:', error);
        throw new Error('Fetch API not available');
      }

      // Common construction material brands by category
      const brandDatabase = {
        cement: ['UltraTech', 'ACC', 'Ambuja', 'Shree Cement', 'Ramco', 'Birla', 'JK Cement', 'Dalmia', 'India Cements', 'Lafarge', 'Heidelberg'],
        steel: ['Tata Steel', 'JSW Steel', 'SAIL', 'Essar Steel', 'Jindal Steel', 'ArcelorMittal', 'Bhushan Steel', 'RINL', 'Vizag Steel', 'Kalyani Steel'],
        iron: ['Tata Steel', 'JSW Steel', 'SAIL', 'Essar Steel', 'Jindal Steel', 'Bhushan Steel', 'RINL', 'Kalyani Steel', 'Godrej', 'Hindalco'],
        bricks: ['Wienerberger', 'Clay Craft', 'Bharat Bricks', 'Magicrete', 'Brickwell', 'Fly Ash Bricks', 'Clay Brick', 'Red Bricks'],
        sand: ['M-Sand', 'River Sand', 'Pit Sand', 'Manufactured Sand', 'Crushed Sand', 'Silica Sand'],
        aggregate: ['Crushed Stone', 'Gravel', 'Coarse Aggregate', 'Fine Aggregate', 'Stone Aggregate'],
        steel_bar: ['Tata Tiscon', 'JSW Neosteel', 'SAIL', 'Kamdhenu', 'Shyam Steel', 'SRMB', 'Prime Gold', 'Meenakshi'],
        tmt: ['Tata Tiscon', 'JSW Neosteel', 'SAIL TMT', 'Kamdhenu', 'Shyam Steel', 'SRMB', 'Prime Gold', 'Meenakshi', 'Vizag TMT'],
        rebar: ['Tata Tiscon', 'JSW Neosteel', 'SAIL', 'Kamdhenu', 'Shyam Steel', 'SRMB', 'Prime Gold'],
        electrical: ['Havells', 'Legrand', 'Schneider Electric', 'Siemens', 'ABB', 'Anchor', 'Polycab', 'Finolex', 'RR Kabel'],
        plumbing: ['Jaguar', 'Parryware', 'Cera', 'Kohler', 'Hindware', 'Roca', 'Jaquar', 'Toto', 'American Standard'],
        hardware: ['Godrej', 'Yale', 'Dormakaba', 'Onida', 'Hafele', 'Blum', 'Hettich', 'Assa Abloy'],
        paint: ['Berger', 'Nerolac', 'Dulux', 'Indigo Paints', 'JSW Paints', 'Kansai Nerolac'],
        tiles: ['Kajaria', 'Somany', 'Hindware', 'Johnson', 'Orient Bell', 'NITCO', 'Regency', 'Rak Ceramics']
      };

      // Get relevant brands for the category
      const categoryLower = (category || '').toLowerCase();
      let relevantBrands = [];

      for (const [key, brands] of Object.entries(brandDatabase)) {
        if (categoryLower.includes(key) || key.includes(categoryLower) ||
            productName.toLowerCase().includes(key) || key.includes(productName.toLowerCase())) {
          relevantBrands = [...relevantBrands, ...brands];
        }
      }

      if (relevantBrands.length === 0) {
        relevantBrands = [
          ...brandDatabase.cement,
          ...brandDatabase.steel,
          ...brandDatabase.iron,
          ...brandDatabase.electrical,
          ...brandDatabase.plumbing
        ];
      }

      const brandsList = [...new Set(relevantBrands)].slice(0, 15).join(', ');

      // Validate category and description match (also uses product name for context)
      let categoryMismatchWarning = null;
      if (category && description && description.trim().length > 0) {
        categoryMismatchWarning = detectCategoryMismatch(category, description, productName);
        if (categoryMismatchWarning) {
          console.log('⚠️ [CATEGORY MISMATCH]', categoryMismatchWarning);
        }
      }

      // Build a prompt that returns structured specifications (key-value pairs)
      // Like Gemini Chat - return specifications in a structured format
      let prompt;

      // Extract number from description if user specified one (e.g., "top 10", "best 10", "first 10")
      // Only extract if it's in specific contexts like "top X", "best X", "first X", etc.
      let requestedCount = null;
      if (aiInstructions.length > 0) {
        // Look for patterns like "top 10", "best 10", "first 10", "only 10", "exactly 10"
        // Case-insensitive matching
        const patterns = [
          /\b(top|best|first|only|exactly|just|give|provide|extract|show|list|generate|create)\s+(\d+)\b/i,
          /\b(\d+)\s+(specifications?|specs?|keys?|items?|fields?|attributes?)\b/i
        ];

        let numberMatch = null;
        let matchedPattern = null;
        for (const pattern of patterns) {
          numberMatch = aiInstructions.match(pattern);
          if (numberMatch) {
            matchedPattern = numberMatch[0];
            // Extract the number (could be in group 1 or 2 depending on pattern)
            const numberStr = numberMatch[2] || numberMatch[1];
            requestedCount = parseInt(numberStr, 10);
            console.log(`🔍 Found number "${numberStr}" in description pattern "${matchedPattern}", parsed as: ${requestedCount}`);
            break; // Use first match found
          }
        }

        // If no specific pattern found, don't extract any number
        // This ensures we only use numbers when explicitly requested with keywords
        if (requestedCount !== null) {
          // Limit to reasonable range (1-20)
          if (requestedCount > 0 && requestedCount <= 20) {
            console.log(`✅ User requested exactly ${requestedCount} specification keys (detected from: "${matchedPattern}")`);
          } else {
            console.log(`⚠️  Number ${requestedCount} is out of range (1-20), ignoring...`);
            requestedCount = null; // Ignore if out of range
          }
        } else {
          console.log(`ℹ️  No number found in AI instructions with keywords like "top X", "best X", "first X", "X specifications": "${aiInstructions.substring(0, 100)}..."`);
        }
      }

      const extractionSystemPrompt = `You are a product-specification extraction assistant for an ecommerce admin panel.

Task:
- Read product name, category, and description.
- Extract the most relevant product specification KEY NAMES.
- Return only valid JSON.

Rules:
1) Output format must be exactly:
{
  "specifications": {
    "<Spec Key>": null
  }
}
2) Keys must be professional ecommerce specification names.
3) Values must always be null.
4) No explanation, no markdown, no extra text.
5) If an exact count is requested, return exactly that many keys.
6) Use category + description context; avoid unrelated keys.
7) If information is insufficient, still return best generic keys for that category in the same JSON format.`;

      if (aiInstructions.length > 0) {
        // Check if user specified a number - if so, enforce it; otherwise extract all relevant keys
        if (requestedCount) {
          prompt = `Generate product specification keys for an ecommerce product page.

Product Name: ${productName}
Product Category: ${category || 'Not specified'}
Admin instructions: ${aiInstructions}
${productDescription ? `Product description (context): ${productDescription}` : ''}

CRITICAL: You MUST generate EXACTLY ${requestedCount} specification keys. NOT ${requestedCount + 1}, NOT ${requestedCount - 1}, NOT ${requestedCount + 2}. EXACTLY ${requestedCount}.

Use BOTH the category "${category || 'Not specified'}" AND the admin instructions to determine the most relevant specification keys.

ABSOLUTE REQUIREMENTS:
1. Generate EXACTLY ${requestedCount} specification keys - NO MORE, NO LESS
2. Generate specification KEY NAMES only (e.g., "Material Grade", "Core Dimensions", "Weight", "Tensile Strength")
3. All values must be null - we only want the key names
4. Use proper, professional specification key names relevant to this product type
5. Consider BOTH the category "${category || 'Not specified'}" AND the admin instructions when generating keys
6. Return keys that would be appropriate for an ecommerce product page
7. No descriptions, no explanations, no examples, no additional text
8. COUNT YOUR KEYS BEFORE RETURNING: The specifications object MUST have exactly ${requestedCount} keys

Return ONLY this JSON structure with EXACTLY ${requestedCount} keys (count them!):
{
  "specifications": {
    "Key 1": null,
    "Key 2": null,
    "Key 3": null,
    ...
    "Key ${requestedCount}": null
  }
}

VERIFICATION: Before returning, count the keys in your specifications object. It must be exactly ${requestedCount}. If you have more than ${requestedCount}, remove the extras. If you have fewer than ${requestedCount}, add more. The final count MUST be ${requestedCount}.`;
        } else {
          // No specific number requested - extract all relevant keys from category and description
          prompt = `Generate the most relevant product specification key names for this ecommerce product.

Product Name: ${productName}
Product Category: ${category || 'Not specified'}
Admin instructions: ${aiInstructions}
${productDescription ? `Product description (context): ${productDescription}` : ''}

IMPORTANT: Extract all relevant specification KEY NAMES for this product.
Use BOTH the category "${category || 'Not specified'}" AND the admin instructions to determine specification keys.

CRITICAL REQUIREMENTS:
1. Generate specification KEY NAMES only (e.g., "Material Grade", "Core Dimensions", "Weight", "Tensile Strength")
2. All values must be null - we only want the key names
3. Use proper, professional specification key names relevant to this product type
4. Consider BOTH the category "${category || 'Not specified'}" AND the description when generating keys
5. Return keys that would be appropriate for an ecommerce product page
6. No descriptions, no explanations, no examples, no additional text

Return ONLY this JSON structure:
{
  "specifications": {
    "<Spec Key>": null
  }
}

Remember: Generate keys based on BOTH the category "${category || 'Not specified'}" AND the admin instructions provided.`;
        }
      } else {
        // No description - generate specification keys from product name and category only
        prompt = `Product Name: ${productName}
Category: ${category || 'Not specified'}

Based ONLY on the product name "${productName}" and category "${category || 'Not specified'}", generate all relevant core specification KEY NAMES for this product type.

CRITICAL RULES:
1. Use ONLY the product name and category
2. Generate specification KEY NAMES only (like "Material Grade", "Core Dimensions", "Weight")
3. Do NOT generate values - only return the key names
4. Return keys with null values (we only want the key names)
5. Use proper specification key names relevant to this product type
6. No descriptions, no explanations, no examples, no additional text

Return ONLY a valid JSON object:
{
  "specifications": {
    "<Spec Key>": null
  }
}

IMPORTANT: Return ONLY the JSON object with specification key names (all values should be null).`;
      }

      let aiResponse;
      let result;

      // Call the appropriate AI provider
      if (selectedProvider === 'openai') {
        // OpenAI/ChatGPT API
        const openaiUrl = 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(openaiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: 'You are a helpful assistant that generates product descriptions for construction materials. Always respond with valid JSON only.'
              },
              {
                role: 'user',
                content: prompt
              }
            ],
            temperature: 0.7,
            max_tokens: 500
          })
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error('OpenAI API error:', errorData);
          throw new Error('OpenAI API service unavailable');
        }

        const data = await response.json();
        aiResponse = data.choices?.[0]?.message?.content?.trim();

        if (!aiResponse) {
          throw new Error('No response from OpenAI API');
        }

      } else if (selectedProvider === 'gemini') {
        // Google Gemini API
        // Validate API key format (Gemini keys typically start with "AIza")
        if (!geminiApiKey || geminiApiKey.trim().length === 0) {
          throw new Error('GEMINI_API_KEY is empty or invalid');
        }

        if (!geminiApiKey.startsWith('AIza') && geminiApiKey.length < 20) {
          console.warn('Warning: Gemini API key format may be incorrect. Expected format: AIza...');
        }

        // First, try to list available models to see what's actually available
        let availableModels = [];
        try {
          // Try both v1 and v1beta endpoints for listing models
          const listModelsUrls = [
            `https://generativelanguage.googleapis.com/v1/models?key=${geminiApiKey}`,
            `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiApiKey}`
          ];

          for (const listModelsUrl of listModelsUrls) {
            try {
              const listResponse = await fetch(listModelsUrl);
              if (listResponse.ok) {
                const listData = await listResponse.json();
                console.log('ListModels response:', JSON.stringify(listData, null, 2));

                if (listData.models && Array.isArray(listData.models)) {
                  availableModels = listData.models
                    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
                    .map(m => {
                      // Extract just the model name (remove 'models/' prefix if present)
                      const name = m.name || '';
                      return name.replace('models/', '');
                    })
                    .filter(name => name && name.includes('gemini'));

                  if (availableModels.length > 0) {
                    console.log('✅ Found available Gemini models:', availableModels);
                    break; // Found models, stop trying other endpoints
                  }
                }
              } else {
                const errorText = await listResponse.text();
                console.log(`ListModels failed for ${listModelsUrl}:`, errorText);
              }
            } catch (e) {
              console.warn(`ListModels error for ${listModelsUrl}:`, e.message);
            }
          }

          if (availableModels.length === 0) {
            console.warn('⚠️  No models found via ListModels, will try common model names');
          }
        } catch (e) {
          console.warn('Could not list available models, using defaults:', e.message);
        }

        // Try Gemini models in order of preference
        // Prefer configured/default paid model first, then fall back to other supported models.
        const preferredGeminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
        const geminiModels = [
          // Preferred model (from env or default)
          { name: preferredGeminiModel, apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          { name: `models/${preferredGeminiModel}`, apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          // Common high-performance models
          { name: 'gemini-2.5-pro', apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          { name: 'models/gemini-2.5-pro', apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          { name: 'gemini-2.5-flash', apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          { name: 'models/gemini-2.5-flash', apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          // Older, still-supported models as fallback
          { name: 'gemini-1.5-flash', apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          { name: 'gemini-1.5-pro', apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          // Try with explicit models/ prefix
          { name: 'models/gemini-1.5-flash', apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          // Try v1 API
          { name: 'gemini-2.5-flash', apiVersion: 'v1', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          { name: 'gemini-1.5-flash', apiVersion: 'v1', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' },
          { name: 'gemini-1.5-pro', apiVersion: 'v1', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' }
        ];

        // If we got available models, prioritize those
        if (availableModels.length > 0) {
          // Prepend available models to the list
          const prioritizedModels = availableModels.map(name => {
            // Extract model name and determine API version
            const parts = name.split('/');
            const modelName = parts[parts.length - 1];
            return { name: modelName, apiVersion: 'v1beta', useRestFormat: false, baseUrl: 'https://generativelanguage.googleapis.com' };
          });
          geminiModels.unshift(...prioritizedModels);
        }

        let lastError = null;

        for (const { name: geminiModel, apiVersion, useRestFormat, baseUrl } of geminiModels) {
          try {
            // Try different URL formats
            let geminiUrl;
            const base = baseUrl || 'https://generativelanguage.googleapis.com';

            if (useRestFormat) {
              // REST API format: https://generativelanguage.googleapis.com/v1/{model}:generateContent
              geminiUrl = `${base}/${apiVersion}/${geminiModel}:generateContent?key=${geminiApiKey}`;
            } else if (geminiModel.startsWith('models/')) {
              // Model name already includes 'models/' prefix
              geminiUrl = `${base}/${apiVersion}/${geminiModel}:generateContent?key=${geminiApiKey}`;
            } else {
              // Standard format: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
              geminiUrl = `${base}/${apiVersion}/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
            }
            console.log(`Trying Gemini API: ${geminiUrl.replace(geminiApiKey, '***KEY***')}`);

            const response = await fetch(geminiUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [{
                    text: extractionSystemPrompt
                  }]
                },
                contents: [{
                  parts: [{
                    text: prompt
                  }]
                }],
                generationConfig: {
                  temperature: 0.8,
                  topP: 0.95,
                  topK: 40,
                  maxOutputTokens: 2000  // Increased for more detailed responses like Gemini Chat
                }
              })
            });

            if (!response.ok) {
              const errorData = await response.text();
              let errorMessage = 'Gemini API service unavailable';
              try {
                const errorJson = JSON.parse(errorData);
                errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
                console.error(`Gemini API error for ${geminiModel} (${apiVersion}):`, errorJson);
                lastError = new Error(`Gemini API error (${geminiModel}): ${errorMessage}`);
              } catch (e) {
                console.error(`Gemini API error (raw) for ${geminiModel}:`, errorData);
                lastError = new Error(`Gemini API error (${geminiModel}): ${errorData}`);
              }
              // Try next model
              continue;
            }

            const data = await response.json();
            aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

            if (!aiResponse) {
              console.error(`Gemini API response structure for ${geminiModel}:`, JSON.stringify(data, null, 2));
              lastError = new Error(`No response from Gemini API (${geminiModel}) - check API key validity`);
              // Try next model
              continue;
            }

            // Success! Break out of the loop
            console.log(`✅ Successfully used Gemini model: ${geminiModel} (${apiVersion}, format: ${useRestFormat ? 'REST' : 'standard'})`);
            break;
          } catch (fetchError) {
            console.error(`Error with Gemini model ${geminiModel}:`, fetchError.message);
            lastError = fetchError;
            // Try next model
            continue;
          }
        }

        // If we've tried all models and still no response, throw the last error
        if (!aiResponse) {
          const errorMsg = lastError
            ? `All Gemini models failed. Last error: ${lastError.message}. Please verify your GEMINI_API_KEY is valid and has access to Gemini models. You can get a new key from https://makersuite.google.com/app/apikey`
            : 'All Gemini models failed. Please check your API key and try again.';
          throw new Error(errorMsg);
        }

      } else if (selectedProvider === 'claude') {
        // Anthropic Claude API
        const claudeUrl = 'https://api.anthropic.com/v1/messages';
        const response = await fetch(claudeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicApiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 500,
            messages: [
              {
                role: 'user',
                content: prompt
              }
            ]
          })
        });

        if (!response.ok) {
          const errorData = await response.text();
          console.error('Claude API error:', errorData);
          throw new Error('Claude API service unavailable');
        }

        const data = await response.json();
        aiResponse = data.content?.[0]?.text?.trim();

        if (!aiResponse) {
          throw new Error('No response from Claude API');
        }
      }

      console.log(`${selectedProvider.toUpperCase()} raw response:`, aiResponse);

      // Parse the JSON response from AI
      try {
        // If user requested a specific count, we'll enforce it after parsing
        // Remove markdown code blocks if present
        let cleanedResponse = aiResponse
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();

        // Try to extract JSON if it's embedded in text
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          cleanedResponse = jsonMatch[0];
        }

        result = JSON.parse(cleanedResponse);
        console.log('✅ Parsed AI result:', result);
      } catch (parseError) {
        console.error('Failed to parse AI response as JSON:', parseError);
        console.error('Raw AI response:', aiResponse);

        return res.status(502).json({
          status: 'error',
          message: 'AI returned an invalid specification response. Try again or adjust your instructions.',
          provider: selectedProvider
        });
      }

      // Extract specifications (key-value pairs) from the result
      let specifications = result.specifications || {};

      // If user requested a specific count, enforce it STRICTLY
      if (requestedCount && requestedCount > 0) {
        // Get all keys, filtering out any invalid entries
        const specKeys = Object.keys(specifications).filter(key => {
          // Only include valid keys (non-empty strings)
          return key && typeof key === 'string' && key.trim().length > 0;
        });

        const actualCount = specKeys.length;

        if (actualCount > requestedCount) {
          console.log(`⚠️  AI returned ${actualCount} keys, but user requested exactly ${requestedCount}. Trimming to ${requestedCount}.`);
          // Keep only the first N keys - STRICTLY enforce the count
          const trimmedSpecs = {};
          specKeys.slice(0, requestedCount).forEach(key => {
            trimmedSpecs[key] = specifications[key];
          });
          specifications = trimmedSpecs;

          // Verify the count after trimming
          const finalCount = Object.keys(specifications).length;
          if (finalCount !== requestedCount) {
            console.warn(`⚠️  After trimming, got ${finalCount} keys instead of ${requestedCount}. Re-trimming...`);
            // Force trim again if needed
            const finalSpecs = {};
            Object.keys(specifications).slice(0, requestedCount).forEach(key => {
              finalSpecs[key] = specifications[key];
            });
            specifications = finalSpecs;
          }

          console.log(`✅ Trimmed to exactly ${requestedCount} specification keys`);
        } else if (actualCount < requestedCount) {
          console.log(`⚠️  AI returned only ${actualCount} keys, but user requested ${requestedCount}. Keeping all available keys.`);
        } else {
          console.log(`✅ AI returned exactly ${requestedCount} keys as requested.`);
        }

        // Final verification - ensure we never return more than requested
        const finalKeyCount = Object.keys(specifications).length;
        if (finalKeyCount > requestedCount) {
          console.error(`❌ ERROR: Still have ${finalKeyCount} keys after trimming. Force trimming to ${requestedCount}...`);
          const forceTrimmed = {};
          Object.keys(specifications).slice(0, requestedCount).forEach(key => {
            forceTrimmed[key] = specifications[key];
          });
          specifications = forceTrimmed;
          console.log(`✅ Force trimmed to exactly ${Object.keys(specifications).length} keys`);
        }
      }

      // Specification assistant returns keys only — never product description copy.
      res.json({
        status: 'success',
        specifications,
        provider: selectedProvider,
        categoryMismatchWarning: categoryMismatchWarning || null
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('AI fetch error:', error);
      console.error('Error stack:', error.stack);

      let errorMessage = 'Failed to fetch data from AI service. Please try again.';

      if (error.message.includes('API key')) {
        errorMessage = 'Invalid or missing API key. Please check your API keys in the .env file.';
      } else if (error.message.includes('Gemini API error')) {
        errorMessage = error.message;
      } else if (error.message.includes('No response')) {
        errorMessage = 'AI service returned no response. Please check your API key and try again.';
      } else if (error.message.includes('fetch')) {
        errorMessage = 'Network error connecting to AI service. Please check your internet connection.';
      } else {
        errorMessage = error.message || errorMessage;
      }

      res.status(500).json({
        status: 'error',
        message: errorMessage,
        provider: 'unknown'
      });
    }
  });

  // AI Tax Fetch endpoint - infer SGST/CGST/IGST rates for a product.
  // This allows admin to fill supplier-product GST keys directly from admin portal.
  router.post('/products/ai-gst', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { productName, category, description, hsnCode, prompt = '', provider = 'auto' } = parseWithSchema(
        adminAiGstSchema,
        req.body || {}
      );

      if (!productName || !String(productName).trim()) {
        return res.status(400).json({
          status: 'error',
          message: 'Product name is required'
        });
      }

      // User-requested strict behavior: Gemini only, no local fallback heuristics.
      const openaiApiKey = process.env.OPENAI_API_KEY;
      const geminiApiKey = process.env.GEMINI_API_KEY;
      const anthropicApiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      const forcedProvider = 'gemini';

      if (!geminiApiKey) {
        return res.status(400).json({
          status: 'error',
          message: 'Gemini API key not configured. Please set GEMINI_API_KEY.'
        });
      }

      let fetch;
      if (typeof globalThis.fetch === 'function') {
        fetch = globalThis.fetch;
      } else {
        const nodeFetch = await import('node-fetch');
        fetch = nodeFetch.default;
      }

      const gstSystemPrompt = `You are an Indian GST assistant for ecommerce product onboarding.
Return ONLY valid JSON in this exact shape:
{
  "hsn_code": "<string, 4-8 digits or empty>",
  "sgst_rate": <number>,
  "cgst_rate": <number>,
  "igst_rate": <number>,
  "confidence": "high|medium|low",
  "reason": "<short reason>"
}
Rules:
1) Use official Indian GST logic and provide the most accurate HSN possible.
2) Use common GST slabs: 0, 5, 12, 18, 28.
3) For intra-state, SGST = CGST = IGST/2.
4) hsn_code must be 4-8 digits.
5) Use numeric values for rates (not strings).
6) Never return markdown or extra text.
7) Return all four fields always.`;

      const gstUserPrompt = `Infer GST rates for this product.
Product Name: ${productName}
Category: ${category || 'Not specified'}
Description: ${description || 'Not provided'}
Admin Note: ${prompt || 'None'}
HSN (if known): ${hsnCode || ''}

Choose the most likely GST slab and return JSON only.`;

      const tryParseJsonFromText = (rawText) => {
        if (!rawText) return null;
        try {
          const cleaned = String(rawText).replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const jsonTextMatch = cleaned.match(/\{[\s\S]*\}/);
          return JSON.parse(jsonTextMatch ? jsonTextMatch[0] : cleaned);
        } catch {
          return null;
        }
      };

      const parseGeminiText = (data) => {
        if (!data?.candidates || !Array.isArray(data.candidates)) return '';
        for (const candidate of data.candidates) {
          const parts = candidate?.content?.parts;
          if (!Array.isArray(parts)) continue;
          const text = parts.map((part) => part?.text || '').join('\n').trim();
          if (text) return text;
        }
        return '';
      };

      const fetchGstFromProvider = async (providerName, overrideUserPrompt = null) => {
        if (providerName === 'openai') {
          if (!openaiApiKey) throw new Error('OpenAI API key not configured');
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${openaiApiKey}`
            },
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [
                { role: 'system', content: gstSystemPrompt },
                { role: 'user', content: gstUserPrompt }
              ],
              temperature: 0.2,
              max_tokens: 220
            })
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
          }
          const data = await response.json();
          return data?.choices?.[0]?.message?.content?.trim() || '';
        }

        if (providerName === 'gemini') {
          if (!geminiApiKey) throw new Error('Gemini API key not configured');
          const lockedGeminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
          const makeGeminiRequest = async ({ promptText, maxTokens }) =>
            fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${lockedGeminiModel}:generateContent?key=${geminiApiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: gstSystemPrompt }] },
                  contents: [{ parts: [{ text: promptText }] }],
                  generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: maxTokens,
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: 'object',
                      required: ['hsn_code', 'sgst_rate', 'cgst_rate', 'igst_rate'],
                      properties: {
                        hsn_code: { type: 'string' },
                        sgst_rate: { type: 'number' },
                        cgst_rate: { type: 'number' },
                        igst_rate: { type: 'number' },
                        confidence: { type: 'string' },
                        reason: { type: 'string' }
                      }
                    }
                  }
                })
              }
            );

          const primaryPrompt = overrideUserPrompt || gstUserPrompt;
          let response = await makeGeminiRequest({ promptText: primaryPrompt, maxTokens: 600 });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Gemini API error (${lockedGeminiModel}, ${response.status}): ${errorText}`);
          }
          let data = await response.json();
          let text = parseGeminiText(data);
          let finishReason = data?.candidates?.[0]?.finishReason || 'unknown';

          // Retry once when model truncates output before returning usable JSON.
          if (!text && finishReason === 'MAX_TOKENS') {
            const compactPrompt = `Return ONLY compact JSON with keys hsn_code,sgst_rate,cgst_rate,igst_rate,confidence,reason.
Product:${productName}
Category:${category || ''}
Description:${description || ''}
Note:${prompt || ''}`;
            response = await makeGeminiRequest({ promptText: compactPrompt, maxTokens: 1200 });
            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(`Gemini API error (${lockedGeminiModel}, ${response.status}) on retry: ${errorText}`);
            }
            data = await response.json();
            text = parseGeminiText(data);
            finishReason = data?.candidates?.[0]?.finishReason || finishReason;
          }

          if (!text) {
            throw new Error(`Gemini returned empty content (${lockedGeminiModel}, finishReason: ${finishReason})`);
          }
          return text;
        }

        throw new Error('Only Gemini provider is allowed for this endpoint');
      };

      let aiResponse = '';
      aiResponse = await fetchGstFromProvider(forcedProvider);
      if (!aiResponse) {
        throw new Error(`No response from AI provider (${forcedProvider})`);
      }

      let parsed = tryParseJsonFromText(aiResponse);
      if (!parsed) {
        // Gemini-only retry: ask Gemini to convert its own response into strict JSON.
        const repairPrompt = `Convert this content into strict valid JSON with keys:
hsn_code, sgst_rate, cgst_rate, igst_rate, confidence, reason
No markdown. No explanation. JSON only.

Content:
${aiResponse}`;
        const repaired = await fetchGstFromProvider(forcedProvider === 'gemini' ? 'gemini' : forcedProvider, repairPrompt);
        parsed = tryParseJsonFromText(repaired);
      }
      if (!parsed) {
        throw new Error('Gemini did not return valid JSON after retry.');
      }

      const allowedIgst = [0, 5, 12, 18, 28];
      const hsnFromGemini = (String(parsed.hsn_code || parsed.hsnCode || '').match(/\b\d{4,8}\b/) || [null])[0];
      const igstRate = Number(parsed.igst_rate);
      const cgstRate = Number(parsed.cgst_rate);
      const sgstRate = Number(parsed.sgst_rate);

      if (!hsnFromGemini) {
        return res.status(422).json({
          status: 'error',
          code: 'gemini_missing_hsn',
          message: 'Gemini response did not include a valid HSN code (4-8 digits).'
        });
      }
      if (![igstRate, cgstRate, sgstRate].every((v) => Number.isFinite(v))) {
        return res.status(422).json({
          status: 'error',
          code: 'gemini_missing_gst_rates',
          message: 'Gemini response did not include all GST rate values.'
        });
      }
      if (!allowedIgst.includes(igstRate)) {
        return res.status(422).json({
          status: 'error',
          code: 'gemini_invalid_igst_slab',
          message: 'Gemini response returned IGST outside allowed slab values.'
        });
      }
      if (cgstRate !== sgstRate) {
        return res.status(422).json({
          status: 'error',
          code: 'gemini_invalid_cgst_sgst',
          message: 'Gemini response has CGST and SGST mismatch.'
        });
      }
      if (Number((cgstRate + sgstRate).toFixed(2)) !== Number(igstRate.toFixed(2))) {
        return res.status(422).json({
          status: 'error',
          code: 'gemini_invalid_tax_math',
          message: 'Gemini response has invalid tax math (IGST must equal CGST+SGST).'
        });
      }

      res.json({
        status: 'success',
        provider: forcedProvider,
        hsn_code: hsnFromGemini,
        sgst_rate: sgstRate,
        cgst_rate: cgstRate,
        igst_rate: igstRate,
        confidence_tier: 'high',
        can_auto_apply: true,
        confidence: parsed.confidence || 'high',
        reason: parsed.reason || 'Exact values returned by Gemini.'
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('AI GST fetch error:', error);
      res.status(500).json({
        status: 'error',
        message: error.message || 'Failed to fetch GST rates from AI service.'
      });
    }
  });

  // Polish supplier-submitted description into customer-facing copy (description only).
  router.post('/products/ai-polish-listing', authenticateToken, isAdmin, async (req, res) => {
    try {
      const payload = parseWithSchema(adminAiPolishListingSchema, req.body || {});
      const result = await polishSupplierListingWithAi({
        productName: payload.productName,
        category: payload.category || '',
        supplierDescription: payload.supplierDescription,
        existingSpecifications: payload.existingSpecifications || {},
        provider: payload.provider || 'auto',
        adminNotes: payload.adminNotes || ''
      });
      return res.status(result.status === 'error' ? 400 : 200).json(result);
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('AI polish listing error:', error);
      return res.status(500).json({
        status: 'error',
        message: error.message || 'Failed to polish listing with AI.'
      });
    }
  });
}
