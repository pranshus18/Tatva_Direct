/**
 * Service-provider voice flow test: search → add to cart → quantity.
 *
 * Usage:
 *   VOICE_SP_EMAIL=you@mail.com VOICE_SP_PASSWORD=secret node voice/scripts/sp-add-cart-flow-test.mjs
 *
 * Or set VOICE_SP_EMAIL / VOICE_SP_PASSWORD in backend/.env
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
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
  if (!res.ok || !data.token) {
    throw new Error(data.message || `Login failed (${res.status})`);
  }
  return data;
}

async function resolveServiceProviderCreds() {
  const email = process.env.VOICE_SP_EMAIL?.trim();
  const password = process.env.VOICE_SP_PASSWORD?.trim();
  if (email && password) return { email, password };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Set VOICE_SP_EMAIL + VOICE_SP_PASSWORD, or ensure SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env'
    );
  }

  const supabase = createClient(url, key);
  const { data: users, error } = await supabase
    .from('users')
    .select('email, user_type, is_active')
    .eq('user_type', 'service_provider')
    .eq('is_active', true)
    .limit(5);

  if (error) throw new Error(`Supabase: ${error.message}`);
  if (!users?.length) {
    throw new Error(
      'No active service_provider in DB. Set VOICE_SP_EMAIL and VOICE_SP_PASSWORD in .env for your SP account.'
    );
  }

  console.log('Found service_provider accounts (need password via VOICE_SP_EMAIL / VOICE_SP_PASSWORD):');
  for (const u of users) console.log(`  - ${u.email}`);
  throw new Error(
    `Set VOICE_SP_EMAIL=${users[0].email} and VOICE_SP_PASSWORD in env, then re-run.`
  );
}

async function timedStep(label, fn) {
  const t0 = Date.now();
  const reply = await fn();
  const ms = Date.now() - t0;
  return { label, ms, reply };
}

async function main() {
  const { email, password } = await resolveServiceProviderCreds();
  const loginData = await login(email, password);
  const userType = loginData.user?.userType || loginData.user?.user_type;

  if (userType !== 'service_provider') {
    throw new Error(`Expected service_provider, got: ${userType || 'unknown'}`);
  }

  console.log(`\nLogged in as service_provider: ${email}\n`);

  const memory = new SessionMemory(newSessionId());
  const orch = new AiOrchestrator(loginData.token, memory);

  const steps = [
    { say: 'search mac air m2', expect: /found|mac/i },
    { say: 'add to cart', expect: /how many/i },
    { say: '2', expect: /added|cart/i },
    { say: 'continue', expect: /supplier/i }
  ];

  const results = [];
  for (const step of steps) {
    const row = await timedStep(step.say, () => orch.handleTranscript(step.say));
    const ok = step.expect.test(row.reply);
    results.push({ ...row, ok, expect: String(step.expect) });
    console.log(`[${row.ms}ms] User: "${step.say}"`);
    console.log(`       Agent: ${row.reply.slice(0, 200)}${row.reply.length > 200 ? '…' : ''}`);
    console.log(`       ${ok ? 'PASS' : 'FAIL'}\n`);
  }

  const pending = memory.getPendingAction();
  const lastSearch = memory.getContext('last_search');

  console.log('--- Summary ---');
  console.log(`Role: service_provider`);
  console.log(`Pending after flow: ${pending ? pending.type : 'none'}`);
  console.log(`Last search products: ${lastSearch?.products?.length ?? 0}`);
  console.log('');
  console.log('| Step | Time | OK |');
  console.log('|------|------|-----|');
  for (const r of results) {
    console.log(`| ${r.label} | ${r.ms}ms | ${r.ok ? 'yes' : 'NO'} |`);
  }
  const total = results.reduce((s, r) => s + r.ms, 0);
  const allOk = results.every((r) => r.ok);
  console.log(`\nTotal server time: ${total}ms`);
  console.log(allOk && !pending ? 'FLOW OK' : 'FLOW FAILED');
  process.exit(allOk && !pending ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
