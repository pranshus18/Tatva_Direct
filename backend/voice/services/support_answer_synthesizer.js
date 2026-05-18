import { truncateForSpeech } from '../summarizeForVoice.js';
import { humanizeSupportReply } from '../lib/humanizeReply.js';
import { geminiService } from './gemini_service.js';

const SUPPORT_SYSTEM = [
  'You are a friendly Tatva Direct support agent on a live voice call with a construction materials buyer.',
  'Sound natural and human: warm, clear, and helpful — like a knowledgeable colleague, not a policy bot.',
  'Answer ONLY using the numbered context. Never invent timelines, fees, or rules.',
  'If context is insufficient, say honestly that you are not sure and suggest the orders page or human support.',
  'Use short spoken sentences (1-3). Contractions are fine. Acknowledge the user concern when relevant.',
  'Do not say you are an AI. Do not read bullet lists verbatim.'
].join(' ');

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

  const { text } = await geminiService.generateWithSystem({
    systemInstruction: SUPPORT_SYSTEM,
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    maxOutputTokens: SUPPORT_MAX_TOKENS,
    temperature: 0.35,
    onChunk
  });

  const answer = humanizeSupportReply(String(text || '').trim());
  if (!answer) throw new Error('Empty support synthesis');
  return truncateForSpeech(answer, 340);
}
