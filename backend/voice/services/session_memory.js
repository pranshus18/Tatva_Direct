export { SessionMemory, newSessionId } from '../sessionMemory.js';

/** Lightweight shopping context — minimal history for Gemini. */
export function extendSessionMemory(memory) {
  return {
    ...memory,
    appendCompact(role, content) {
      const messages = memory.getJson('compact_messages', []);
      messages.push({ role, content });
      memory.setJson('compact_messages', messages.slice(-4));
    },
    getCompactHistory(limit = 2) {
      return memory.getJson('compact_messages', []).slice(-limit);
    }
  };
}
