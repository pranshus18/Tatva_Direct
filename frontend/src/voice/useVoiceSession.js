import { useCallback, useEffect, useRef, useState } from 'react';
import { createSpeechRecognizer, speakText, stopSpeaking } from './browserSpeech.js';
import { createVoiceSocket } from './voiceSocket.js';

/**
 * Hook: WebSocket session + browser STT/TTS.
 * Debug: set localStorage.VOICE_DEBUG = '1' for console logs.
 */
export function useVoiceSession(token) {
  const debug = typeof localStorage !== 'undefined' && localStorage.getItem('VOICE_DEBUG') === '1';

  const [state, setState] = useState('connecting');
  const [error, setError] = useState('');
  const [listening, setListening] = useState(false);
  const [lastReply, setLastReply] = useState('');
  const [interimText, setInterimText] = useState('');

  const socketRef = useRef(null);
  const recognizerRef = useRef(null);

  const log = useCallback(
    (...args) => {
      if (debug) console.log('[voice]', ...args);
    },
    [debug]
  );

  const speak = useCallback(
    (text) => {
      speakText(text, {
        onStart: () => setState('speaking'),
        onEnd: () => setState('listening')
      });
    },
    []
  );

  useEffect(() => {
    if (!token) return undefined;

    const socket = createVoiceSocket({
      token,
      handlers: {
        onOpen: () => log('ws open'),
        onMessage: (data) => {
          log('msg', data.type, data);
          if (data.type === 'auth_ok') {
            setState('listening');
            setError('');
            return;
          }
          if (data.type === 'agent_state') {
            setState(data.state || 'listening');
            return;
          }
          if (data.type === 'agent_reply') {
            const reply = data.text || '';
            setLastReply(reply);
            speak(reply);
            return;
          }
          if (data.type === 'error') {
            setError(data.message || data.code || 'Voice error');
            if (data.code !== 'use_browser_stt') setState('error');
          }
        },
        onError: (err) => {
          setError(err.message || 'Connection error');
          setState('error');
        },
        onClose: () => setState('disconnected')
      }
    });
    socketRef.current = socket;

    return () => {
      socket.close();
      socketRef.current = null;
      stopSpeaking();
    };
  }, [token, log, speak]);

  const startListening = useCallback(() => {
    setError('');
    const rec = createSpeechRecognizer({
      onInterim: setInterimText,
      onError: (e) => {
        setError(
          e.error === 'not-allowed' ? 'Microphone permission denied' : e.error || 'Speech error'
        );
        setListening(false);
      }
    });
    if (!rec.isSupported) {
      setError('Speech recognition not supported. Use Chrome or Edge.');
      return;
    }
    recognizerRef.current = rec;
    rec.start();
    setListening(true);
    setState('listening');
  }, []);

  const stopListening = useCallback(() => {
    const text = recognizerRef.current?.stop() || '';
    setListening(false);
    setInterimText('');
    if (text) {
      log('send', text);
      socketRef.current?.sendText(text);
    }
  }, [log]);

  return {
    state,
    error,
    listening,
    lastReply,
    interimText,
    startListening,
    stopListening
  };
}
