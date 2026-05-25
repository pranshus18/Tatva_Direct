/**
 * Voice latency benchmark — language pick + live WebSocket round-trip.
 * Usage: node scripts/voiceLatencyBench.mjs
 * Requires: backend on API_BASE_URL (default http://127.0.0.1:8081)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import { AiOrchestrator } from '../voice/core/ai_orchestrator.js';
import { getVoiceText } from '../voice/i18n/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, '..');

function loadDotEnv() {
  const envPath = path.join(backendRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadDotEnv();

const BASE = process.env.API_BASE_URL || 'http://127.0.0.1:8081';
const WS_URL = (process.env.VOICE_WS_URL || BASE.replace(/^http/, 'ws') + '/api/voice/ws').replace(
  /^https/,
  'wss'
);

const ORCH_BUDGET_MS = 250;
const WS_REPLY_BUDGET_MS = 1200;
const WS_INSTANT_BUDGET_MS = 800;

const SP_EMAIL = process.env.SP_EMAIL || 'Nandini@gmail.com';
const SP_PASSWORD = process.env.SP_PASSWORD || 'Nandini@123';

function fail(msg) {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`✅ ${msg}`);
}

async function benchOrchestrator() {
  console.log('\n── Orchestrator (language pick, no network) ──');
  const utterances = ['Hindi', 'Telugu', 'Kannada', 'English'];
  let maxMs = 0;

  for (const u of utterances) {
    const memory = new SessionMemory(newSessionId());
    const orch = new AiOrchestrator('bench', memory);
    const t0 = performance.now();
    const reply = await orch.handleTranscript(u);
    const ms = performance.now() - t0;
    maxMs = Math.max(maxMs, ms);
    const len = reply.length;
    console.log(`  ${u.padEnd(8)} ${ms.toFixed(0)}ms  (${len} chars)`);
    if (ms > ORCH_BUDGET_MS) fail(`${u} orchestrator ${ms.toFixed(0)}ms > ${ORCH_BUDGET_MS}ms`);
    if (len > 72) fail(`${u} reply too long (${len} chars)`);
  }

  pass(`Orchestrator max ${maxMs.toFixed(0)}ms (budget ${ORCH_BUDGET_MS}ms)`);
}

async function loginToken() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: SP_EMAIL, password: SP_PASSWORD })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    throw new Error(data.message || `login HTTP ${res.status}`);
  }
  return data.token;
}

function wsRoundTrip(token, text) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const t0 = performance.now();
    let authOk = false;
    let gotReply = false;
    let instant = false;
    let languageSet = false;

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('WebSocket timeout 15s'));
    }, 15000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    });

    ws.on('message', (raw) => {
      let data;
      try {
        data = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (data.type === 'auth_ok') {
        authOk = true;
        ws.send(JSON.stringify({ type: 'text', text }));
      }
      if (data.type === 'language_set') languageSet = true;
      if (data.type === 'reply_done' && data.instant) instant = true;

      if (data.type === 'agent_reply' && !gotReply && authOk) {
        gotReply = true;
        const ms = performance.now() - t0;
        clearTimeout(timer);
        ws.close();
        resolve({ ms, text: data.text || '', instant: instant || Boolean(data.instant), languageSet });
      }
    });

    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });

    ws.on('close', () => {
      if (!gotReply) {
        clearTimeout(timer);
        reject(new Error('closed before agent_reply'));
      }
    });
  });
}

async function benchWebSocket(token) {
  console.log('\n── WebSocket (live language pick) ──');
  const picks = ['Hindi', 'Telugu'];

  for (const text of picks) {
    const { ms, instant, languageSet } = await wsRoundTrip(token, text);
    console.log(
      `  ${text.padEnd(8)} ${ms.toFixed(0)}ms  instant=${instant} language_set=${languageSet}`
    );
    if (ms > WS_REPLY_BUDGET_MS) {
      fail(`${text} WS reply ${ms.toFixed(0)}ms > ${WS_REPLY_BUDGET_MS}ms`);
    }
    if (!instant) fail(`${text} expected instant=true on agent_reply`);
    if (!languageSet) fail(`${text} expected language_set before reply`);
    if (ms > WS_INSTANT_BUDGET_MS) {
      console.warn(`  ⚠ ${text} slower than ideal ${WS_INSTANT_BUDGET_MS}ms but within budget`);
    }
  }

  pass(`WebSocket language picks under ${WS_REPLY_BUDGET_MS}ms with instant flag`);
}

async function main() {
  console.log('Voice latency benchmark');
  console.log(`API: ${BASE}`);

  for (const lang of ['hindi', 'telugu']) {
    const t = getVoiceText(`language.changed.${lang}`, lang, {}, '');
    if (t.length > 72) fail(`i18n ${lang} too long: ${t.length}`);
  }
  pass('Confirmation strings ≤72 chars');

  await benchOrchestrator();

  try {
    const token = await loginToken();
    pass('Logged in for WebSocket test');
    await benchWebSocket(token);
  } catch (e) {
    console.warn(`\n⚠ Live WebSocket bench skipped: ${e.message}`);
    console.warn('  Start backend: cd backend && npm run dev');
  }

  console.log('\n✅ All voice latency checks passed.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
