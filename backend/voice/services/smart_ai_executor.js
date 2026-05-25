import { ActionType } from '../core/routeTypes.js';
import { GEMINI_TOOL_DECLARATIONS } from '../voiceTools.js';
import { truncateForSpeech } from '../summarizeForVoice.js';
import { shouldUseSupportRag } from '../lib/supportIntent.js';
import { geminiService } from './gemini_service.js';
import { ragService } from './rag_service.js';
import { toolCallingEngine } from './tool_calling_engine.js';
import { resolveVoiceLanguage } from '../lib/voiceLanguage.js';
import { getVoiceText } from '../i18n/index.js';
import { getConversationalSystemPrompt } from '../lib/voicePersonality.js';

const TOOL_RESULT_MAX = Number.parseInt(String(process.env.VOICE_TOOL_RESULT_MAX || '600'), 10) || 600;
const MAX_ROUNDS = Number.parseInt(String(process.env.VOICE_MAX_TOOL_ROUNDS || '1'), 10) || 1;

const CONVERSATIONAL_SYSTEM = getConversationalSystemPrompt();

/**
 * Smart AI Path — Gemini + RAG for recommendations, comparisons, FAQs, guidance.
 */
export const smartAiExecutor = {
  async execute(text, toolCtx, memory, { onChunk, action } = {}) {
    const utterance = String(text || '').trim();
    const voiceLanguage = resolveVoiceLanguage(memory);

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
          onChunk,
          language: voiceLanguage
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
        const fallback = getVoiceText('smart.fallback', voiceLanguage, {}, '');
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

      const output = truncateForSpeech(
        replyText || getVoiceText('smart.done', voiceLanguage, {}, 'Done.')
      );
      memory.appendCompact('user', utterance);
      memory.appendCompact('assistant', output);
      return output;
    }

    return getVoiceText('smart.retryHint', voiceLanguage, {}, '');
  }
};
