import logger from '../utils/logger.js';
import { handleConfirmationGate } from './confirmations.js';
import { createVoiceToolContext, GEMINI_TOOL_DECLARATIONS, runTool } from './voiceTools.js';

const SYSTEM = `You are Tatva voice commerce assistant for construction material buyers (service providers).
Use tools for cart, orders, payments, search, and addresses. Never invent order IDs or stock.
Use answer_support_question only for FAQs, policies, refunds — not transactions.
Keep responses short (1-3 sentences) for voice.`;

function modelName() {
  return process.env.GEMINI_MODEL || 'gemini-2.0-flash';
}

async function geminiGenerate({ contents, tools = null }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');

  const model = modelName().replace(/^models\//, '');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 512 }
  };
  if (tools) {
    body.tools = [{ functionDeclarations: tools }];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`Gemini API error: ${msg}`);
  }
  return data;
}

function extractParts(candidate) {
  const parts = candidate?.content?.parts || [];
  return parts;
}

export class VoiceOrchestrator {
  constructor(token, memory) {
    this.token = token;
    this.memory = memory;
    this.toolCtx = createVoiceToolContext(token, memory);
  }

  async runPending(pending) {
    const ptype = pending.type;
    const payload = pending.payload || {};
    this.memory.setPendingAction(null);

    if (ptype === 'place_order') return this.toolCtx.executePlaceOrder(payload);
    if (ptype === 'cancel_order') return this.toolCtx.executeCancelOrder(payload);
    if (ptype === 'payment') {
      return this.toolCtx.executeOnlinePayment(payload.order_id);
    }
    return 'Unknown pending action.';
  }

  async handleTranscript(userText) {
    const text = String(userText || '').trim();
    if (!text) return "I didn't catch that. Please try again.";

    const pending = this.memory.getPendingAction();
    const gate = await handleConfirmationGate(text, pending, {
      onConfirm: (p) => this.runPending(p),
      onReject: async () => {
        this.memory.setPendingAction(null);
        return 'Okay, I cancelled that action.';
      }
    });
    if (gate.handled && gate.reply) {
      this.memory.appendMessage('user', text);
      this.memory.appendMessage('assistant', gate.reply);
      return gate.reply;
    }

    const history = this.memory.getMessages().slice(-8);
    const contents = [];
    for (const msg of history) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
    contents.push({ role: 'user', parts: [{ text }] });

    let iterations = 0;
    const maxIter = 6;

    while (iterations < maxIter) {
      iterations += 1;
      const data = await geminiGenerate({
        contents,
        tools: GEMINI_TOOL_DECLARATIONS
      });

      const candidate = data.candidates?.[0];
      if (!candidate) {
        return 'Sorry, I could not generate a response.';
      }

      const parts = extractParts(candidate);
      const functionCalls = parts.filter((p) => p.functionCall).map((p) => p.functionCall);
      const textParts = parts.filter((p) => p.text).map((p) => p.text);

      if (functionCalls.length) {
        contents.push({ role: 'model', parts });
        const responseParts = [];
        for (const fc of functionCalls) {
          const name = fc.name;
          const args = fc.args || {};
          logger.info(`[voice] tool ${name}`);
          const result = await runTool(this.toolCtx, name, args);
          responseParts.push({
            functionResponse: {
              name,
              response: { result: String(result).slice(0, 8000) }
            }
          });
        }
        contents.push({ role: 'user', parts: responseParts });
        continue;
      }

      const output = textParts.join(' ').trim() || 'Done.';
      this.memory.appendMessage('user', text);
      this.memory.appendMessage('assistant', output);
      return output;
    }

    return 'Sorry, I had trouble completing that. Please try again.';
  }
}
