import { randomUUID } from 'node:crypto';

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

  appendMessage(role, content, limit = 20) {
    const messages = this.getJson('messages', []);
    messages.push({ role, content });
    this.setJson('messages', messages.slice(-limit));
  }

  getMessages() {
    return this.getJson('messages', []);
  }

  setPendingAction(action) {
    this.setJson('pending_action', action || null);
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
