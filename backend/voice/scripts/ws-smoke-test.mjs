/**
 * Smoke test: WebSocket auth + voice text message.
 * Usage: VOICE_TEST_TOKEN=<jwt> node voice/scripts/ws-smoke-test.mjs "search cement"
 */
import WebSocket from 'ws';

const token = process.env.VOICE_TEST_TOKEN;
const phrase = process.argv[2] || 'search cement';
const url = process.env.VOICE_WS_URL || 'ws://127.0.0.1:8081/api/voice/ws';

if (!token) {
  console.error('Set VOICE_TEST_TOKEN to a service_provider JWT from browser localStorage');
  process.exit(1);
}

const ws = new WebSocket(url);
let reply = '';

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'auth', token }));
});

ws.on('message', (raw) => {
  const data = JSON.parse(String(raw));
  console.log('[ws]', data.type, data.text?.slice?.(0, 120) || data.message || data.state || '');

  if (data.type === 'auth_ok') {
    ws.send(JSON.stringify({ type: 'text', text: phrase }));
  }
  if (data.type === 'reply_chunk') reply += data.text || '';
  if (data.type === 'agent_reply' || data.type === 'reply_done') {
    console.log('\n--- FINAL ---\n', data.text || reply);
    ws.close();
    process.exit(0);
  }
  if (data.type === 'error') {
    console.error('Error:', data);
    process.exit(1);
  }
});

ws.on('error', (e) => {
  console.error('WS error:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('Timeout after 25s');
  process.exit(1);
}, 25000);
