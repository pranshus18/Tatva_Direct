/**
 * End-to-end voice flow test (orchestrator, same session).
 * Usage: VOICE_SP_EMAIL=... VOICE_SP_PASSWORD=... node voice/scripts/voice-flow-e2e-test.mjs
 */
import 'dotenv/config';
import { SessionMemory, newSessionId } from '../sessionMemory.js';
import { AiOrchestrator } from '../core/ai_orchestrator.js';

const BASE = `http://127.0.0.1:${process.env.PORT || 8081}`;

async function login(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error(data.message || `Login failed ${res.status}`);
  if (data.user?.userType !== 'service_provider') {
    throw new Error(`Expected service_provider, got ${data.user?.userType}`);
  }
  return data.token;
}

async function step(label, orch, memory, text) {
  const t0 = Date.now();
  const reply = await orch.handleTranscript(text);
  const ms = Date.now() - t0;
  const pending = memory.getPendingAction()?.type || 'none';
  const ok = reply && reply.length > 5 && !/could not|failed|error/i.test(reply.slice(0, 80));
  console.log(`${ok ? 'PASS' : 'FAIL'} [${ms}ms] ${label}`);
  console.log(`  >> ${text}`);
  console.log(`  << ${reply.slice(0, 180)}${reply.length > 180 ? '…' : ''}`);
  console.log(`  pending: ${pending}\n`);
  return { ok, ms, reply, pending };
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

  const token = await login(email, password);
  const memory = new SessionMemory(newSessionId());
  const orch = new AiOrchestrator(token, memory);

  const results = [];
  results.push(await step('search', orch, memory, 'mac air m2'));
  results.push(await step('select product', orch, memory, 'add to cart'));
  results.push(await step('quantity', orch, memory, '2'));
  results.push(await step('cart continue', orch, memory, 'continue'));
  results.push(await step('supplier', orch, memory, '1'));

  let pendingType = memory.getPendingAction()?.type;
  if (pendingType === 'await_substitution') {
    results.push(await step('substitution', orch, memory, 'no substitution'));
    pendingType = memory.getPendingAction()?.type;
  }

  if (pendingType === 'await_po_details') {
    results.push(await step('delivery date', orch, memory, 'default'));
    results.push(await step('payment', orch, memory, 'cash on delivery'));
    results.push(await step('address', orch, memory, 'yes'));
    pendingType = memory.getPendingAction()?.type;
  }

  pendingType = memory.getPendingAction()?.type;
  if (pendingType === 'await_transport') {
    results.push(await step('transport', orch, memory, '1'));
    pendingType = memory.getPendingAction()?.type;
  }

  if (pendingType === 'await_place_confirm') {
    results.push(await step('place order', orch, memory, 'place the order'));
  }

  const failed = results.filter((r) => !r.ok);
  console.log('---');
  console.log(`Steps: ${results.length}, Failed: ${failed.length}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
