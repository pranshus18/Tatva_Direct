import {
  answerSupportQuestion,
  retrieveSupportContext,
  getSupportRetrievalConfidence,
  warmSupportIndex
} from '../supportRetriever.js';
import { getSupportFallbackHuman } from '../lib/humanizeReply.js';
import { resolveVoiceLanguage } from '../lib/voiceLanguage.js';
import { synthesizeSupportAnswer } from './support_answer_synthesizer.js';

const DEFAULT_K = Number.parseInt(String(process.env.VOICE_RAG_TOP_K || '5'), 10) || 5;
const MIN_CONFIDENCE = Number.parseFloat(String(process.env.VOICE_RAG_MIN_CONFIDENCE || '0.12')) || 0.12;
const AUTO_RAG_CONFIDENCE =
  Number.parseFloat(String(process.env.VOICE_RAG_AUTO_CONFIDENCE || '0.45')) || 0.45;
const USE_SYNTHESIS = String(process.env.VOICE_RAG_SYNTHESIZE ?? 'true').toLowerCase() !== 'false';

/** RAG only for FAQs, policies, manuals — never for cart/orders. */
export const ragService = {
  warm() {
    return warmSupportIndex();
  },

  retrieve(query, k = DEFAULT_K) {
    return retrieveSupportContext(query, k);
  },

  getConfidence(query, k = 3) {
    const hits = retrieveSupportContext(query, k);
    return getSupportRetrievalConfidence(hits);
  },

  /** Snippet-only answer (sync, legacy callers). */
  answer(query) {
    return answerSupportQuestion(query);
  },

  /**
   * Grounded support answer: retrieve → confidence gate → human-like Gemini synthesis.
   */
  async answerGrounded(query, { onChunk, memory } = {}) {
    const q = String(query || '').trim();
    const hits = retrieveSupportContext(q, DEFAULT_K);
    const confidence = getSupportRetrievalConfidence(hits);

    if (!hits.length || confidence < MIN_CONFIDENCE) {
      return getSupportFallbackHuman(resolveVoiceLanguage(memory));
    }

    if (USE_SYNTHESIS && process.env.GEMINI_API_KEY) {
      try {
        return await synthesizeSupportAnswer(q, hits.slice(0, 4), { onChunk, memory });
      } catch {
        /* fall through to snippet */
      }
    }

    return answerSupportQuestion(q);
  },

  /** True when retrieval is strong enough to answer without guessing. */
  isHighConfidencePolicyQuery(query) {
    return this.getConfidence(query) >= AUTO_RAG_CONFIDENCE;
  }
};
