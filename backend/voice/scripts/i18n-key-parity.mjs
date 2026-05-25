/** Fail if hi/kn/te catalogs miss any en voice keys. */
import { enVoiceTexts } from '../i18n/en.js';
import { hiVoiceTexts } from '../i18n/hi.js';
import { knVoiceTexts } from '../i18n/kn.js';
import { teVoiceTexts } from '../i18n/te.js';

const catalogs = { hi: hiVoiceTexts, kn: knVoiceTexts, te: teVoiceTexts };
const enKeys = Object.keys(enVoiceTexts);
/** Hinglish uses the English catalog at runtime; not required in hi/kn/te files. */
const HINGLISH_ONLY_KEYS = new Set(['language.changed.hinglish', 'greeting.hinglish']);
let failed = 0;

for (const [name, cat] of Object.entries(catalogs)) {
  for (const key of enKeys) {
    if (HINGLISH_ONLY_KEYS.has(key)) continue;
    if (!cat[key]) {
      console.error(`MISSING ${name}: ${key}`);
      failed += 1;
    }
  }
}

if (failed) process.exit(1);
console.log('i18n-key-parity: ok', enKeys.length, 'keys per locale');
