/** Play streaming audio from server TTS (PCM16 or MP3) — one utterance at a time, no mid-word cuts. */

let audioCtx = null;
let nextStart = 0;
let decodeChain = Promise.resolve();
let playbackGen = 0;
const activeSources = new Set();

function getCtx() {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

export async function resumeAudioPlayback() {
  const ctx = getCtx();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      /* ignore */
    }
  }
}

function stopActiveSources() {
  for (const source of activeSources) {
    try {
      source.stop(0);
    } catch {
      /* already ended */
    }
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
  }
  activeSources.clear();
}

function decodePcm16Base64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const samples = new Float32Array(bytes.length / 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

const PLAYBACK_RATE =
  Number.parseFloat(String(import.meta.env.VITE_VOICE_PLAYBACK_RATE || '1')) || 1;

/** Small lead-in so the first phoneme is not clipped. */
const LEAD_IN_SEC = 0.04;

function effectiveDuration(buffer) {
  const rate =
    PLAYBACK_RATE > 0.85 && PLAYBACK_RATE < 1.15 && PLAYBACK_RATE !== 1 ? PLAYBACK_RATE : 1;
  return buffer.duration / rate;
}

function scheduleBuffer(buffer, gen) {
  if (gen !== playbackGen) return false;
  const ctx = getCtx();
  if (ctx.state === 'suspended') void ctx.resume();

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  if (PLAYBACK_RATE > 0.85 && PLAYBACK_RATE < 1.15 && PLAYBACK_RATE !== 1) {
    source.playbackRate.value = PLAYBACK_RATE;
  }
  source.connect(ctx.destination);

  const now = ctx.currentTime;
  const startAt = Math.max(now + LEAD_IN_SEC, nextStart);
  source.start(startAt);
  activeSources.add(source);
  source.onended = () => activeSources.delete(source);

  nextStart = startAt + effectiveDuration(buffer);
  return true;
}

export function getPlaybackRemainingSec() {
  const ctx = audioCtx;
  if (!ctx || ctx.state === 'closed') return 0;
  return Math.max(0, nextStart - ctx.currentTime);
}

/**
 * Start a new spoken line — stops previous audio without destroying the AudioContext
 * (closing the context was cutting words mid-playback).
 */
export function beginPlaybackUtterance() {
  playbackGen += 1;
  const gen = playbackGen;
  stopActiveSources();
  decodeChain = Promise.resolve();
  const ctx = getCtx();
  nextStart = ctx.currentTime + LEAD_IN_SEC;
  return gen;
}

export function resetAudioPlayback() {
  beginPlaybackUtterance();
}

/**
 * @param {string} base64Chunk
 * @param {{ encoding?: 'pcm16'|'mp3', sampleRate?: number, generation?: number }} [opts]
 */
export function playAudioChunk(
  base64Chunk,
  { encoding = 'pcm16', sampleRate = 24000, generation = null } = {}
) {
  if (!base64Chunk) return false;

  const gen = generation ?? playbackGen;
  if (gen !== playbackGen) return false;

  const ctx = getCtx();
  if (ctx.state === 'suspended') void ctx.resume();

  if (encoding === 'mp3') {
    const binary = atob(base64Chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const buf = bytes.buffer.slice(0);

    decodeChain = decodeChain
      .then(() => {
        if (gen !== playbackGen) return null;
        return ctx.decodeAudioData(buf);
      })
      .then((audioBuffer) => {
        if (!audioBuffer || gen !== playbackGen) return;
        scheduleBuffer(audioBuffer, gen);
      })
      .catch(() => {});

    return true;
  }

  const samples = decodePcm16Base64(base64Chunk);
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  scheduleBuffer(buffer, gen);
  return true;
}

export function playPcmChunk(base64Chunk, sampleRate = 24000) {
  return playAudioChunk(base64Chunk, { encoding: 'pcm16', sampleRate });
}
