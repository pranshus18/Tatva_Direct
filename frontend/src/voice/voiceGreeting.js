import { voiceText } from './voiceText.js';

export function getVoiceGreeting(language = 'english') {
  const key = language === 'hinglish' ? 'greeting.hinglish' : 'greeting.default';
  return voiceText(language, key, {}, voiceText('english', 'greeting.default'));
}
