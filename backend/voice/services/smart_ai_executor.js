import { ActionType } from '../core/routeTypes.js';
import { GEMINI_TOOL_DECLARATIONS } from '../voiceTools.js';
import { truncateForSpeech } from '../summarizeForVoice.js';
import { shouldUseSupportRag } from '../lib/supportIntent.js';
import { geminiService } from './gemini_service.js';
import { ragService } from './rag_service.js';
import { toolCallingEngine } from './tool_calling_engine.js';

const TOOL_RESULT_MAX = Number.parseInt(String(process.env.VOICE_TOOL_RESULT_MAX || '600'), 10) || 600;
const MAX_ROUNDS = Number.parseInt(String(process.env.VOICE_MAX_TOOL_ROUNDS || '1'), 10) || 1;

const CONVERSATIONAL_SYSTEM = [
  'You are Tatva Direct voice shopping assistant — friendly, concise, human.',
  'Help with products, cart, and orders using tools when needed.',
  'For policy or FAQ topics you do not know, say you can help with returns, shipping, or payments — do not invent policies.',
  'Keep replies to 1-2 short spoken sentences.'
].join(' ');

/**
 * Smart AI Path — Gemini + RAG for recommendations, comparisons, FAQs, guidance.
 */
export const smartAiExecutor = {
  async execute(text, toolCtx, memory, { onChunk, action } = {}) {
    const utterance = String(text || '').trim();

    if (shouldUseSupportRag(utterance, action)) {
      const answer = await ragService.answerGrounded(utterance, { onChunk, memory });
      memory.appendCompact('user', utterance);
      memory.appendCompact('assistant', answer);
      return answer;
    }

    if (
      (action === ActionType.CONVERSATIONAL || action === ActionType.UNKNOWN) &&
      ragService.isHighConfidencePolicyQuery(utterance)
    ) {
      const answer = await ragService.answerGrounded(utterance, { onChunk, memory });
      memory.appendCompact('user', utterance);
      memory.appendCompact('assistant', answer);
      return answer;
    }

    const ragHits = ragService.retrieve(utterance, 3);
    const ragContext = ragHits.map((h) => h.snippet).join('\n');

    const history = memory.getCompactHistory(2);
    const contents = history.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const userPrompt = ragContext
      ? `${utterance}\n\nRelevant policy info:\n${ragContext}`
      : utterance;
    contents.push({ role: 'user', parts: [{ text: userPrompt }] });

    let rounds = 0;
    while (rounds < MAX_ROUNDS) {
      rounds += 1;
      let replyText = '';
      let functionCalls = [];
      try {
        const generated = await geminiService.streamGenerate({
          contents,
          tools: GEMINI_TOOL_DECLARATIONS,
          systemOverride: CONVERSATIONAL_SYSTEM,
          onChunk
        });
        replyText = generated.text || '';
        functionCalls = generated.functionCalls || [];
      } catch {
        if (ragHits.length && ragService.isHighConfidencePolicyQuery(utterance)) {
          const answer = await ragService.answerGrounded(utterance, { onChunk, memory });
          memory.appendCompact('user', utterance);
          memory.appendCompact('assistant', answer);
          return answer;
        }
        const fallback =
          'I can help you search products, manage your cart, or answer questions about returns, shipping, and payments. Try saying show my cart or how do refunds work.';
        memory.appendCompact('user', utterance);
        memory.appendCompact('assistant', fallback);
        return truncateForSpeech(fallback);
      }

      if (functionCalls?.length) {
        contents.push({
          role: 'model',
          parts: functionCalls.map((fc) => ({ functionCall: fc }))
        });

        const responses = await Promise.all(
          functionCalls.map(async (fc) => {
            const result = await toolCallingEngine.runGeminiTool(toolCtx, fc.name, fc.args || {});
            return {
              functionResponse: {
                name: fc.name,
                response: { result: String(result).slice(0, TOOL_RESULT_MAX) }
              }
            };
          })
        );

        contents.push({ role: 'user', parts: responses });
        continue;
      }

      const output = truncateForSpeech(replyText || 'Done.');
      memory.appendCompact('user', utterance);
      memory.appendCompact('assistant', output);
      return output;
    }

    return 'Try asking about a product, or say show my cart.';
  }
};
