import {
  resolveVoiceUiScreenForNavigate,
  buildVoiceNavigatePayload,
  setVoiceUiScreenKey
} from '../lib/voice_ui_screens.js';

/**
 * Tell the client which app page matches the current voice step.
 */
export function sendVoiceUiNavigate(ws, memory, { replyText = '', instant = false } = {}) {
  if (!ws || ws.readyState !== ws.OPEN || !memory || instant) return;

  const screen = resolveVoiceUiScreenForNavigate(memory, replyText);
  const payload = buildVoiceNavigatePayload(screen, memory);
  if (!payload) return;

  setVoiceUiScreenKey(memory, payload.screen);

  const pathKey = payload.path;
  const screenKey = payload.screen;
  if (ws._lastVoiceNavigateScreen === screenKey && ws._lastVoiceNavigatePath === pathKey) {
    return;
  }
  ws._lastVoiceNavigateScreen = screenKey;
  ws._lastVoiceNavigatePath = pathKey;
  ws._lastVoiceNavigateLabel = payload.label || '';

  ws.send(JSON.stringify({ type: 'ui_navigate', ...payload }));
}
