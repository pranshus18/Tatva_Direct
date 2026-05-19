import { randomUUID } from 'node:crypto';
import { syncVoiceUiScreenForPending } from './lib/voice_ui_screens.js';
import { normalizePendingForFlow } from './lib/voice_flow_mode.js';

const store = new Map();
const TTL_MS = (Number.parseInt(String(process.env.VOICE_SESSION_TTL_SEC || '3600'), 10) || 3600) * 1000;

export function newSessionId() {
  return randomUUID();
}

export class SessionMemory {
  constructor(sessionId) {
    this.sessionId = sessionId;
  }

  _bucket() {
    if (!store.has(this.sessionId)) {
      store.set(this.sessionId, { expiresAt: Date.now() + TTL_MS, data: {} });
    }
    const row = store.get(this.sessionId);
    if (row.expiresAt < Date.now()) {
      row.data = {};
      row.expiresAt = Date.now() + TTL_MS;
    }
    row.expiresAt = Date.now() + TTL_MS;
    return row.data;
  }

  getJson(key, fallback = null) {
    const val = this._bucket()[key];
    return val === undefined ? fallback : val;
  }

  setJson(key, value) {
    this._bucket()[key] = value;
  }

  appendMessage(role, content, limit = 8) {
    const messages = this.getJson('messages', []);
    messages.push({ role, content });
    this.setJson('messages', messages.slice(-limit));
  }

  appendCompact(role, content, limit = 4) {
    const messages = this.getJson('compact_messages', []);
    messages.push({ role, content });
    this.setJson('compact_messages', messages.slice(-limit));
  }

  getCompactHistory(limit = 2) {
    return this.getJson('compact_messages', []).slice(-limit);
  }

  getMessages() {
    return this.getJson('messages', []);
  }

  setPendingAction(action) {
    const normalized = normalizePendingForFlow(this, action);
    this.setJson('pending_action', normalized || null);
    if (normalized?.type) syncVoiceUiScreenForPending(this, normalized.type);
  }

  getPendingAction() {
    return this.getJson('pending_action', null);
  }

  setContext(key, value) {
    const ctx = this.getJson('context', {});
    ctx[key] = value;
    this.setJson('context', ctx);
  }

  getContext(key, fallback = null) {
    return this.getJson('context', {})[key] ?? fallback;
  }
}
