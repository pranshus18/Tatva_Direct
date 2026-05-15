import { isConfirm, isReject } from './intents.js';

export async function handleConfirmationGate(userText, pending, { onConfirm, onReject }) {
  if (!pending) return { handled: false, reply: null };

  if (isConfirm(userText)) {
    return { handled: true, reply: await onConfirm(pending) };
  }
  if (isReject(userText)) {
    return { handled: true, reply: await onReject() };
  }
  return {
    handled: true,
    reply: `I'm waiting for your confirmation to ${pending.summary || 'complete this action'}. Say yes to confirm or no to cancel.`
  };
}
