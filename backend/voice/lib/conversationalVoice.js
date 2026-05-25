/**
 * Engagement layer — brief acks and leads so scripted replies feel like a live
 * Tatva teammate, not a form reader. Keeps TTS short; all call languages.
 */

import { normalizeVoiceLanguage } from './voiceLanguageCore.js';

const POOLS = {
  english: {
    ack: ['Got it.', 'Sure thing.', 'Perfect.', 'Alright.', 'Nice one.', 'You bet.'],
    welcomeLead: ['Great to have you here —', 'Welcome aboard —', 'Good to connect —'],
    searchLead: ['Here we go —', 'Found it —', 'Good news —', 'Nice match —'],
    qtyLead: ['Love it —', 'Great pick —', 'Solid choice —'],
    cartLead: ['Done —', 'All set —', 'In your cart —'],
    supplierLead: ['Nice choice —', 'Locked in —', 'Smart pick —'],
    transportLead: ['Almost there —', 'Last stretch —', 'Courier time —'],
    poLead: ['Quick details —', 'Nearly done —', 'Just a couple things —'],
    confirmLead: ['Ready when you are —', 'Summary for you —'],
    doneLead: ['Brilliant —', 'You\'re all set —', 'We did it —'],
    notFoundLead: ['No exact hit yet —', 'Let me help —', 'Hmm, try this —'],
    helpLead: ['You\'re in good hands —', 'Easy —', 'No stress —'],
    navLead: ['On it —', 'Taking you there —'],
    waitLead: ['One sec —', 'Bear with me —', 'Just a moment —']
  },
  hinglish: {
    ack: ['Got it.', 'Sure.', 'Theek hai.', 'Perfect.', 'Bilkul.'],
    welcomeLead: ['Achha laga call aaya —', 'Welcome —'],
    searchLead: ['Mil gaya —', 'Found it —', 'Yeh raha —'],
    qtyLead: ['Achha choice —', 'Great —'],
    cartLead: ['Ho gaya —', 'Cart me hai —'],
    supplierLead: ['Theek supplier —', 'Done —'],
    transportLead: ['Almost done —', 'Courier choose karo —'],
    poLead: ['Thodi detail —', 'Almost there —'],
    confirmLead: ['Summary suno —', 'Ready —'],
    doneLead: ['Ho gaya sab —', 'All set —'],
    notFoundLead: ['Exact match nahi —', 'Try karo —'],
    helpLead: ['Tension mat lo —', 'Main hoon —'],
    navLead: ['Chalo —', 'Open kar raha —'],
    waitLead: ['Ek sec —', 'Bas moment —']
  },
  hindi: {
    ack: ['ठीक है।', 'बिल्कुल।', 'समझ गया।', 'अच्छा।', 'हाँ जी।'],
    welcomeLead: ['आपका स्वागत है —', 'अच्छा लगा कॉल आई —', 'जुड़कर अच्छा लगा —'],
    searchLead: ['मिल गया —', 'ये रहा —', 'अच्छी खबर —', 'देखिए —'],
    qtyLead: ['बढ़िया चुनाव —', 'अच्छा —', 'ठीक रहेगा —'],
    cartLead: ['हो गया —', 'कार्ट में है —', 'डाल दिया —'],
    supplierLead: ['बढ़िया सप्लायर —', 'चुन लिया —', 'सही चुनाव —'],
    transportLead: ['लगभग हो गया —', 'कूरियर चुनिए —', 'आखिरी कदम —'],
    poLead: ['थोड़ी डिटेल —', 'बस दो बातें —', 'लगभग पूरा —'],
    confirmLead: ['सारांश सुनिए —', 'तैयार हैं —'],
    doneLead: ['बहुत बढ़िया —', 'सब तैयार —', 'हो गया —'],
    notFoundLead: ['अभी मैच नहीं —', 'कोशिश करते हैं —', 'एक बार फिर —'],
    helpLead: ['चिंता मत —', 'मैं यहाँ हूँ —', 'आसान है —'],
    navLead: ['खोल रहा हूँ —', 'चलिए —'],
    waitLead: ['एक सेकंड —', 'बस पल —', 'थोड़ा रुकिए —']
  },
  kannada: {
    ack: ['ಸರಿ.', 'ಖಂಡಿತ.', 'ಒಳ್ಳೆಯದು.', 'ಸಿಕ್ಕಿತು.', 'ಹೌದು.'],
    welcomeLead: ['ಸ್ವಾಗತ —', 'ಕರೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದ —', 'ಒಟ್ಟಿಗೆ ಮಾಡೋಣ —'],
    searchLead: ['ಸಿಕ್ಕಿತು —', 'ಇದು ನೋಡಿ —', 'ಒಳ್ಳೆ ಸುದ್ದಿ —'],
    qtyLead: ['ಒಳ್ಳೆಯ ಆಯ್ಕೆ —', 'ಸರಿ —'],
    cartLead: ['ಆಯಿತು —', 'ಕಾರ್ಟ್‌ನಲ್ಲಿದೆ —'],
    supplierLead: ['ಒಳ್ಳೆಯ ಸಪ್ಲೈಯರ್ —', 'ಆಯ್ಕೆ ಆಯಿತು —'],
    transportLead: ['ಬಹುತೇಕ ಮುಗಿದು —', 'ಕೊರಿಯರ್ ಆಯ್ಕೆ —'],
    poLead: ['ಸ್ವಲ್ಪ ವಿವರ —', 'ಇನ್ನೂ ಸ್ವಲ್ಪ —'],
    confirmLead: ['ಸಾರಾಂಶ —', 'ಸಿದ್ಧವೇ —'],
    doneLead: ['ಅದ್ಭುತ —', 'ಎಲ್ಲಾ ಸಿದ್ಧ —', 'ಮುಗಿಯಿತು —'],
    notFoundLead: ['ಇನ್ನೂ ಹೊಂದಾಣಿಕೆ ಇಲ್ಲ —', 'ಪ್ರಯತ್ನಿಸೋಣ —'],
    helpLead: ['ಚಿಂತೆ ಇಲ್ಲ —', 'ನಾನು ಇಲ್ಲಿದ್ದೇನೆ —'],
    navLead: ['ತೆರೆಯುತ್ತೇನೆ —', 'ಹೋಗೋಣ —'],
    waitLead: ['ಒಂದು ಕ್ಷಣ —', 'ಸ್ವಲ್ಪ ನಿರೀಕ್ಷೆ —']
  },
  telugu: {
    ack: ['సరే.', 'ఖచ్చితంగా.', 'బాగుంది.', 'దొరికింది.', 'అవును.'],
    welcomeLead: ['స్వాగతం —', 'కాల్ చేసినందుకు ధన్యవాదాలు —', 'కలిసి చేద్దాం —'],
    searchLead: ['దొరికింది —', 'ఇది చూడండి —', 'మంచి వార్త —'],
    qtyLead: ['మంచి ఎంపిక —', 'సరే —'],
    cartLead: ['అయ్యింది —', 'కార్ట్‌లో ఉంది —'],
    supplierLead: ['మంచి సప్లైయర్ —', 'ఎంచుకున్నాం —'],
    transportLead: ['దాదాపు అయిపోయింది —', 'కూరియర్ ఎంపిక —'],
    poLead: ['కొంచెం వివరం —', 'ఇంకా కొద్ది —'],
    confirmLead: ['సారాంశం —', 'సిద్ధమే —'],
    doneLead: ['అద్భుతం —', 'అన్నీ సిద్ధం —', 'పూర్తయింది —'],
    notFoundLead: ['ఇంకా మ్యాచ్ లేదు —', 'మళ్ళీ ప్రయత్నిద్దాం —'],
    helpLead: ['ఆందోళన లేదు —', 'నేను ఇక్కడే ఉన్నాను —'],
    navLead: ['తెరుస్తున్నాను —', 'వెళ్దాం —'],
    waitLead: ['ఒక్క క్షణం —', 'కొంచెం వేచండి —']
  }
};

function poolsFor(lang) {
  const id = normalizeVoiceLanguage(lang) || 'english';
  return POOLS[id] || POOLS.english;
}

function pick(pool, seed = 0) {
  if (!pool?.length) return '';
  return pool[Math.abs(seed) % pool.length];
}

/** Stable-ish variety from memory turn count or random. */
export function engagementSeed(memory) {
  const n = memory?.getContext?.('voice_engage')?.turns ?? 0;
  if (memory?.setContext) {
    memory.setContext('voice_engage', { turns: n + 1 });
  }
  return n + Math.floor(Math.random() * 5);
}

/**
 * @param {string} lang
 * @param {string} body - main scripted line
 * @param {{ leadPool?: string, ack?: boolean, seed?: number, memory?: object, alwaysAck?: boolean }} opts
 */
export function wrapEngaging(lang, body, opts = {}) {
  const text = String(body || '').trim();
  if (!text) return text;

  const { leadPool, ack = false, alwaysAck = false, seed = 0, memory = null } = opts;
  const s = seed || engagementSeed(memory);
  const p = poolsFor(lang);
  const parts = [];

  const mode = s % 3;
  if (alwaysAck && p.ack?.length) {
    parts.push(pick(p.ack, s));
  } else if (ack && leadPool && mode === 0 && p.ack?.length) {
    parts.push(pick(p.ack, s));
  } else if (leadPool && p[leadPool]?.length && (mode === 1 || mode === 2 || !ack)) {
    parts.push(pick(p[leadPool], s + 1));
  } else if (ack && p.ack?.length && mode === 2) {
    parts.push(pick(p.ack, s));
  }
  parts.push(text);

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** Softer join for two short sentences (e.g. added + handoff). */
export function joinEngaging(parts) {
  return parts
    .filter(Boolean)
    .map((x) => String(x).trim())
    .filter(Boolean)
    .join(' ');
}
