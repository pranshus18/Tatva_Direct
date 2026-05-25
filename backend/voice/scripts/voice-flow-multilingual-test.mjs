/**
 * Same checkout path as voice-flow-e2e-test.mjs but with Hindi / Kannada / Telugu phrases.
 * Usage: VOICE_SP_EMAIL=... VOICE_SP_PASSWORD=... node voice/scripts/voice-flow-multilingual-test.mjs
 */
import 'dotenv/config';
import { SessionMemory, newSessionId } from '../sessionMemory.js';
import { AiOrchestrator } from '../core/ai_orchestrator.js';

const BASE = `http://127.0.0.1:${process.env.PORT || 8081}`;

const LANG = String(process.env.VOICE_FLOW_LANG || 'all').toLowerCase();

const SCENARIOS = {
  hindi: {
    label: 'Hindi',
    search: 'cement khojo',
    add: 'cart mein jod do',
    qty: 'do',
    continue: 'aage badho',
    supplier: '1',
    noSub: 'substitution nahi',
    date: 'default',
    payment: 'cash on delivery',
    address: 'haan',
    transport: '1',
    place: 'order place karo'
  },
  kannada: {
    label: 'Kannada',
    search: 'cement hudi',
    add: 'cart ge serisu',
    qty: 'eradu',
    continue: 'munduvarisu',
    supplier: '1',
    noSub: 'substitution beda',
    date: 'default heli',
    payment: 'cash on delivery',
    address: 'howdu',
    transport: '1',
    place: 'order place maadi'
  },
  telugu: {
    label: 'Telugu',
    search: 'cement vethuku',
    add: 'cart lo add cheyyandi',
    qty: 'rendu',
    continue: 'munduku',
    supplier: '1',
    noSub: 'substitution ledu',
    date: 'default cheppandi',
    payment: 'cash on delivery',
    address: 'avunu',
    transport: '1',
    place: 'order place cheyyandi'
  }
};

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(data.message || `Login failed ${res.status}`);
  return data.token;
}

async function step(label, orch, memory, text) {
  const reply = await orch.handleTranscript(text);
  const pending = memory.getPendingAction()?.type || 'none';
  const ok = reply && reply.length > 5 && !/could not|failed|error/i.test(reply.slice(0, 80));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  console.log(`  >> ${text}`);
  console.log(`  << ${reply.slice(0, 160)}${reply.length > 160 ? '…' : ''}`);
  console.log(`  pending: ${pending}\n`);
  return { ok, pending };
}

async function runScenario(key, phrases) {
  console.log(`\n=== ${phrases.label} (${key}) ===\n`);
  const token = await login(
    process.env.VOICE_SP_EMAIL?.trim(),
    process.env.VOICE_SP_PASSWORD?.trim()
  );
  const memory = new SessionMemory(newSessionId());
  memory.setVoiceLanguage(key === 'hindi' ? 'hindi' : key);
  memory.setVoiceLanguageSelected(true);
  const orch = new AiOrchestrator(token, memory);
  const results = [];

  results.push(await step('search', orch, memory, phrases.search));
  results.push(await step('add', orch, memory, phrases.add));
  results.push(await step('qty', orch, memory, phrases.qty));
  results.push(await step('continue', orch, memory, phrases.continue));
  results.push(await step('supplier', orch, memory, phrases.supplier));

  if (memory.getPendingAction()?.type === 'await_substitution') {
    results.push(await step('substitution skip', orch, memory, phrases.noSub));
  }

  if (memory.getPendingAction()?.type === 'await_po_details') {
    results.push(await step('PO date', orch, memory, phrases.date));
    results.push(await step('PO payment', orch, memory, phrases.payment));
    results.push(await step('PO address', orch, memory, phrases.address));
  }

  if (memory.getPendingAction()?.type === 'await_transport') {
    results.push(await step('transport', orch, memory, phrases.transport));
  }

  if (memory.getPendingAction()?.type === 'await_place_confirm') {
    results.push(await step('place', orch, memory, phrases.place));
  }

  const failed = results.filter((r) => !r.ok).length;
  return { key, failed, total: results.length };
}

async function main() {
  const email = process.env.VOICE_SP_EMAIL?.trim();
  const password = process.env.VOICE_SP_PASSWORD?.trim();
  if (!email || !password) {
    console.error('Set VOICE_SP_EMAIL and VOICE_SP_PASSWORD');
    process.exit(1);
  }
  try {
    await fetch(`${BASE}/api/health`);
  } catch {
    console.error('Backend not running on', BASE);
    process.exit(1);
  }

  const keys =
    LANG === 'all' ? Object.keys(SCENARIOS) : SCENARIOS[LANG] ? [LANG] : [];
  if (!keys.length) {
    console.error('VOICE_FLOW_LANG must be hindi, kannada, telugu, or all');
    process.exit(1);
  }

  const summary = [];
  for (const key of keys) {
    summary.push(await runScenario(key, SCENARIOS[key]));
  }

  console.log('---');
  for (const s of summary) {
    console.log(`${s.key}: ${s.total - s.failed}/${s.total} passed`);
  }
  const anyFail = summary.some((s) => s.failed > 0);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
