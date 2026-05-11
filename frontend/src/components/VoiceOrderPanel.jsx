import React, { useEffect, useRef, useState } from 'react';
import Vapi from '@vapi-ai/web';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { getApiUrl } from '../config/api';
import './VoiceOrderPanel.css';

const VoiceOrderPanel = ({ pageContext = null }) => {
  const vapiRef = useRef(null);
  const sessionRef = useRef(null);
  const isManualEndRef = useRef(false);
  const reconnectAttemptedRef = useRef(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const safeText = (value, fallback = '') => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') return value;
    try {
      return String(value);
    } catch {
      try {
        return JSON.stringify(value);
      } catch {
        return fallback;
      }
    }
  };

  const setupVapiEvents = (vapi) => {
    vapi.on('call-start', () => setStatus('in_call'));
    vapi.on('call-end', async () => {
      setStatus('idle');
      setMuted(false);
      if (!isManualEndRef.current && sessionRef.current && !reconnectAttemptedRef.current) {
        reconnectAttemptedRef.current = true;
        setError('Voice call ended unexpectedly. Reconnecting once...');
        try {
          await vapi.start(sessionRef.current.assistantId, {
            metadata: {
              voiceSessionToken: sessionRef.current.voiceSessionToken
            }
          });
          setStatus('in_call');
          setError('');
          return;
        } catch (reconnectError) {
          setStatus('error');
          setError(
            safeText(reconnectError?.message, '') ||
              'Call ended unexpectedly and reconnect failed. Please click Start Voice again.'
          );
        }
      }
      isManualEndRef.current = false;
    });
    vapi.on('speech-start', () => setStatus('listening'));
    vapi.on('speech-end', () => setStatus('thinking'));
    vapi.on('error', (evt) => {
      const errorText =
        safeText(evt?.error, '') ||
        safeText(evt?.message, '') ||
        'Voice call failed';
      setError(errorText);
      setStatus('error');
    });
  };

  useEffect(() => () => {
    if (vapiRef.current) {
      try {
        vapiRef.current.stop();
      } catch {
        // Ignore cleanup stop failure.
      }
    }
  }, []);

  const handleStart = async () => {
    setError('');
    setStatus('connecting');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please log in again before using voice ordering.');
      const sessionRes = await fetch(getApiUrl('/api/voice/vapi/session'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          channel: 'web',
          pageContext: pageContext || undefined
        })
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok || sessionData.status !== 'success') {
        throw new Error(sessionData.message || 'Failed to initialize voice session.');
      }
      if (!sessionData.publicKey || !sessionData.assistantId) {
        throw new Error('Voice is not configured yet. Missing Vapi public key or assistant id.');
      }
      if (!vapiRef.current) {
        vapiRef.current = new Vapi(sessionData.publicKey);
        setupVapiEvents(vapiRef.current);
      }
      sessionRef.current = {
        assistantId: sessionData.assistantId,
        voiceSessionToken: sessionData.voiceSessionToken
      };
      isManualEndRef.current = false;
      reconnectAttemptedRef.current = false;
      await vapiRef.current.start(sessionData.assistantId, {
        metadata: {
          voiceSessionToken: sessionData.voiceSessionToken
        }
      });
      setStatus('in_call');
    } catch (e) {
      setStatus('error');
      setError(safeText(e?.message, '') || 'Failed to start voice ordering.');
    }
  };

  const handleEnd = async () => {
    if (!vapiRef.current) return;
    isManualEndRef.current = true;
    await vapiRef.current.stop();
    setStatus('idle');
    setMuted(false);
  };

  const handleToggleMute = async () => {
    if (!vapiRef.current) return;
    const next = !muted;
    await vapiRef.current.setMuted(next);
    setMuted(next);
  };

  const statusLabelMap = {
    idle: 'Ready',
    connecting: 'Connecting...',
    in_call: 'Voice order active',
    listening: 'Listening...',
    thinking: 'Processing...',
    error: 'Error'
  };
  const safeStatus = safeText(status, 'idle');

  return (
    <div className="voice-order-panel">
      <div className="voice-order-panel__content">
        <h3>Voice Order (Vapi)</h3>
        <span className={`voice-order-panel__status voice-order-panel__status--${safeStatus}`}>
          {statusLabelMap[safeStatus] || safeStatus}
        </span>
        {error ? <p className="voice-order-panel__error">{error}</p> : null}
      </div>
      <div className="voice-order-panel__actions">
        {status === 'idle' || status === 'error' ? (
          <button type="button" className="btn-primary" onClick={handleStart}>
            <Mic size={16} /> Start Voice
          </button>
        ) : (
          <>
            <button type="button" className="btn-secondary" onClick={handleToggleMute}>
              {muted ? <Mic size={16} /> : <MicOff size={16} />}
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" className="btn-secondary voice-order-panel__end" onClick={handleEnd}>
              <PhoneOff size={16} /> End
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VoiceOrderPanel;
