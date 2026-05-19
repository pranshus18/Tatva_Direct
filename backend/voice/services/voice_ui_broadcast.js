import {
  resolveVoiceUiScreen,
  resolveVoiceUiScreenFromReply,
  voiceScreenToPayload,
  setVoiceUiScreenKey
} from '../lib/voice_ui_screens.js';

/**
 * Tell the client which app page matches the current voice step.
 * Prefers the step spoken in the reply ("Step N, Label") so the UI matches what the user hears.
 */
export function sendVoiceUiNavigate(ws, memory, { replyText = '' } = {}) {
  if (!ws || ws.readyState !== ws.OPEN || !memory) return;

  const screen =
    resolveVoiceUiScreenFromReply(replyText) || resolveVoiceUiScreen(memory, replyText);
  const payload = voiceScreenToPayload(screen);
  if (!payload) return;

  setVoiceUiScreenKey(memory, payload.screen);

  const pathKey = payload.path;
  const labelKey = payload.label || '';
  if (ws._lastVoiceNavigatePath === pathKey && ws._lastVoiceNavigateLabel === labelKey) {
    return;
  }
  ws._lastVoiceNavigatePath = pathKey;
  ws._lastVoiceNavigateLabel = labelKey;

  ws.send(JSON.stringify({ type: 'ui_navigate', ...payload }));
}
