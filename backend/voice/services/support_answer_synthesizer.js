import { truncateForSpeech } from '../summarizeForVoice.js';
import { humanizeSupportReply } from '../lib/humanizeReply.js';
import { geminiService } from './gemini_service.js';
import { resolveVoiceLanguage } from '../lib/voiceLanguage.js';
import { buildSupportSystemPrompt, VOICE_SUPPORT_TEMPERATURE } from '../lib/voicePersonality.js';

const SUPPORT_MAX_TOKENS =
  Number.parseInt(String(process.env.VOICE_SUPPORT_MAX_OUTPUT_TOKENS || '160'), 10) || 160;

function buildContextBlock(hits) {
  return hits
    .map((h, i) => `[${i + 1}] ${h.title} (${h.source}): ${h.snippet}`)
    .join('\n\n');
}

function buildHistoryBlock(memory) {
  if (!memory?.getCompactHistory) return '';
  const turns = memory.getCompactHistory(3);
  if (!turns.length) return '';
  return turns.map((m) => `${m.role}: ${m.content}`).join('\n');
}

/**
 * Grounded support answer — Gemini synthesizes from retrieved chunks only.
 */
export async function synthesizeSupportAnswer(question, hits, { onChunk, memory } = {}) {
  const context = buildContextBlock(hits);
  const history = buildHistoryBlock(memory);
  const historyBlock = history ? `\nRecent conversation:\n${history}\n` : '';

  const userText = `${historyBlock}Customer question: ${question}\n\nPolicy context:\n${context}\n\nNatural spoken answer:`;

  const lang = resolveVoiceLanguage(memory);
  const { text } = await geminiService.generateWithSystem({
    systemInstruction: buildSupportSystemPrompt(lang),
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    maxOutputTokens: SUPPORT_MAX_TOKENS,
    temperature: VOICE_SUPPORT_TEMPERATURE,
    onChunk,
    language: resolveVoiceLanguage(memory)
  });

  const answer = humanizeSupportReply(String(text || '').trim());
  if (!answer) throw new Error('Empty support synthesis');
  return truncateForSpeech(answer, 340);
}
