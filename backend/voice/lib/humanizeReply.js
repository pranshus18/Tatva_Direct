/** Normalize support replies for natural spoken delivery. */

const ROBOTIC_PATTERNS = [
  [/\bAccording to (?:our |the )?policy,?\s*/gi, ''],
  [/\bAs per (?:the )?policy,?\s*/gi, ''],
  [/\bThe context (?:states|indicates) that\s*/gi, ''],
  [/\bBased on the (?:provided )?context,?\s*/gi, ''],
  [/\bI am an AI\b/gi, ''],
  [/\bI'm an AI\b/gi, '']
];

export function humanizeSupportReply(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of ROBOTIC_PATTERNS) {
    s = s.replace(pattern, replacement);
  }
  if (s && !/[.!?]$/.test(s)) s += '.';
  return s;
}

export const SUPPORT_FALLBACK_HUMAN =
  "I'm not sure about that — I don't have it in our policies. Check your orders page or contact support and they'll help you out.";

export const VOICE_AGENT_GREETING = 'Hey, this is Pranshu, your AI assistant.';

export const GREETING_HUMAN = VOICE_AGENT_GREETING;

export const THANKS_HUMAN = "You're welcome! Anything else I can help with?";
