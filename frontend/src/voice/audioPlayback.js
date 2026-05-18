/** Play streaming PCM16 chunks from Piper (base64). */

let audioCtx = null;
let nextStart = 0;

function getCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });
  }
  return audioCtx;
}

/** Resume Web Audio after a user gesture (required on mobile / strict autoplay). */
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

export function resetAudioPlayback() {
  nextStart = 0;
  if (audioCtx) {
    try {
      audioCtx.close();
    } catch {
      /* ignore */
    }
    audioCtx = null;
  }
}

export function playPcmChunk(base64Chunk, sampleRate = 22050) {
  if (!base64Chunk) return false;
  const ctx = getCtx();
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
  const samples = decodePcm16Base64(base64Chunk);
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  const startAt = Math.max(ctx.currentTime, nextStart);
  source.start(startAt);
  nextStart = startAt + buffer.duration;
  return true;
}
