import { useEffect, useRef, useState } from 'react';

const SPEAK_ON = 0.042;
const SPEAK_OFF = 0.028;
const SILENCE_HOLD_MS = 100;

/**
 * Microphone level while `active` is true, plus isSpeaking (hysteresis).
 */
export function useMicLevel(active) {
  const [level, setLevel] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const silenceTimerRef = useRef(null);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      setIsSpeaking(false);
      speakingRef.current = false;
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      return undefined;
    }

    let cancelled = false;
    let stream = null;
    let audioCtx = null;
    let rafId = 0;
    let analyser = null;
    let timeData = null;

    const setSpeaking = (next) => {
      if (speakingRef.current === next) return;
      speakingRef.current = next;
      setIsSpeaking(next);
    };

    const updateSpeaking = (rawLevel) => {
      if (rawLevel >= SPEAK_ON) {
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
        setSpeaking(true);
        return;
      }
      if (!speakingRef.current) return;
      if (rawLevel > SPEAK_OFF) return;
      if (silenceTimerRef.current) return;
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        setSpeaking(false);
      }, SILENCE_HOLD_MS);
    };

    const tick = () => {
      if (!analyser || cancelled) return;

      analyser.getByteTimeDomainData(timeData);
      let sumSq = 0;
      for (let i = 0; i < timeData.length; i += 1) {
        const v = (timeData[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / timeData.length);
      const smoothed = Math.min(1, rms * 5);
      setLevel(smoothed);
      updateSpeaking(smoothed);
      rafId = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true }
        });
        if (cancelled) return;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        timeData = new Uint8Array(analyser.fftSize);
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        tick();
      } catch {
        if (!cancelled) {
          setLevel(0);
          setSpeaking(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close().catch(() => {});
    };
  }, [active]);

  return { level, isSpeaking };
}
