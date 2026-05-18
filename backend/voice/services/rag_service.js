import {
  answerSupportQuestion,
  retrieveSupportContext,
  warmSupportIndex
} from '../supportRetriever.js';

/** RAG only for FAQs, policies, manuals — never for cart/orders. */
export const ragService = {
  warm() {
    return warmSupportIndex();
  },

  retrieve(query, k = 2) {
    return retrieveSupportContext(query, k);
  },

  answer(query) {
    return answerSupportQuestion(query);
  }
};
