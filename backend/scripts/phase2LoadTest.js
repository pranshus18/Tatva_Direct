/**
 * Simple Phase 2 smoke/load script.
 * Usage:
 *   PHASE2_TOKEN=<jwt> node scripts/phase2LoadTest.js
 */

const baseUrl = process.env.PHASE2_BASE_URL || 'http://localhost:8081';
const token = process.env.PHASE2_TOKEN || '';
const iterations = Number(process.env.PHASE2_ITERATIONS || 20);

if (!token) {
  console.error('Missing PHASE2_TOKEN environment variable');
  process.exit(1);
}

async function call(path, options = {}) {
  const started = Date.now();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const elapsedMs = Date.now() - started;
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    elapsedMs,
    body: text
  };
}

async function main() {
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const result = await call('/api/core-phase2/baseline-kpis');
    samples.push(result);
    if (!result.ok) {
      console.error(`[${i + 1}/${iterations}] FAIL ${result.status} ${result.elapsedMs}ms`);
      console.error(result.body);
    } else {
      console.log(`[${i + 1}/${iterations}] OK ${result.elapsedMs}ms`);
    }
  }

  const ok = samples.filter((s) => s.ok);
  const fail = samples.filter((s) => !s.ok);
  const p95 = ok.length
    ? ok.map((s) => s.elapsedMs).sort((a, b) => a - b)[Math.floor(ok.length * 0.95) - 1] || 0
    : 0;
  const avg = ok.length ? Math.round(ok.reduce((sum, s) => sum + s.elapsedMs, 0) / ok.length) : 0;

  console.log('\nPhase2 load summary');
  console.log(`- total: ${samples.length}`);
  console.log(`- success: ${ok.length}`);
  console.log(`- fail: ${fail.length}`);
  console.log(`- avg_ms: ${avg}`);
  console.log(`- p95_ms: ${p95}`);

  process.exit(fail.length ? 1 : 0);
}

main().catch((error) => {
  console.error('Load test script failed:', error);
  process.exit(1);
});
