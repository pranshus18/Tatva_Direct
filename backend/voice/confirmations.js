import { isConfirm, isReject } from './intents.js';
import { getVoiceText } from './i18n/index.js';
import { resolveVoiceLanguage } from './lib/voiceLanguage.js';

export async function handleConfirmationGate(userText, pending, { onConfirm, onReject, memory = null }) {
  if (!pending) return { handled: false, reply: null };

  const lang = resolveVoiceLanguage(memory);

  if (isConfirm(userText)) {
    return { handled: true, reply: await onConfirm(pending) };
  }
  if (isReject(userText)) {
    return { handled: true, reply: await onReject() };
  }
  return {
    handled: true,
    reply: getVoiceText(
      'confirm.waiting',
      lang,
      {
        summary:
          pending.summary ||
          getVoiceText('confirm.pendingDefault', lang, {}, 'complete this action')
      },
      ''
    )
  };
}
