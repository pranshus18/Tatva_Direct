import { ActionType } from '../core/routeTypes.js';
import { GEMINI_TOOL_DECLARATIONS } from '../voiceTools.js';
import { truncateForSpeech } from '../summarizeForVoice.js';
import { geminiService } from './gemini_service.js';
import { ragService } from './rag_service.js';
import { toolCallingEngine } from './tool_calling_engine.js';

const TOOL_RESULT_MAX = Number.parseInt(String(process.env.VOICE_TOOL_RESULT_MAX || '600'), 10) || 600;
const MAX_ROUNDS = Number.parseInt(String(process.env.VOICE_MAX_TOOL_ROUNDS || '1'), 10) || 1;

/**
 * Smart AI Path — Gemini + RAG only for recommendations, comparisons, FAQs, guidance.
 */
export const smartAiExecutor = {
  async execute(text, toolCtx, memory, { onChunk, action } = {}) {
    const utterance = String(text || '').trim();

    if (action === ActionType.SUPPORT_RAG || /\b(refund|policy|faq|return|warranty|shipping)\b/i.test(utterance)) {
      const answer = ragService.answer(utterance);
      if (onChunk) onChunk(answer);
      memory.appendCompact('user', utterance);
      memory.appendCompact('assistant', answer);
      return answer;
    }

    const ragHits = ragService.retrieve(utterance, 2);
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
      const { text: replyText, functionCalls } = await geminiService.streamGenerate({
        contents,
        tools: GEMINI_TOOL_DECLARATIONS,
        onChunk
      });

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

    return 'Try asking about a product or say show my cart.';
  }
};
