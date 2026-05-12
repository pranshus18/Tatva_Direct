import React, { useEffect, useRef, useState } from 'react';
import { RetellWebClient } from 'retell-client-js-sdk';
import { Mic, MicOff, PhoneOff } from 'lucide-react';
import { getApiUrl } from '../config/api';
import './VoiceOrderPanel.css';

const VoiceOrderPanel = ({ pageContext = null }) => {
  const retellRef = useRef(null);
  const sessionRef = useRef(null);
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

  const setupRetellEvents = (retell) => {
    retell.on('call_started', () => {
      setStatus('in_call');
      setError('');
    });
    retell.on('call_ended', () => {
      setStatus('idle');
      setMuted(false);
    });
    retell.on('agent_start_talking', () => setStatus('thinking'));
    retell.on('agent_stop_talking', () => setStatus('listening'));
    retell.on('error', (evt) => {
      const errorText = safeText(evt?.error, '') || safeText(evt?.message, '') || safeText(evt, '') || 'Voice call failed';
      setError(errorText);
      setStatus('error');
    });
  };

  useEffect(() => () => {
    if (retellRef.current) {
      try {
        retellRef.current.stopCall();
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
      const sessionRes = await fetch(getApiUrl('/api/voice/session'), {
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
      if (!sessionData.retellAccessToken || !sessionData.agentId) {
        throw new Error('Voice is not configured yet. Missing Retell access token or agent id.');
      }
      if (!retellRef.current) {
        retellRef.current = new RetellWebClient();
        setupRetellEvents(retellRef.current);
      }
      sessionRef.current = {
        retellAccessToken: sessionData.retellAccessToken,
        voiceSessionToken: sessionData.voiceSessionToken,
        agentId: sessionData.agentId
      };
      await retellRef.current.startCall({
        accessToken: sessionData.retellAccessToken
      });
      setStatus('in_call');
    } catch (e) {
      setStatus('error');
      setError(safeText(e?.message, '') || 'Failed to start voice ordering.');
    }
  };

  const handleEnd = async () => {
    if (!retellRef.current) return;
    await retellRef.current.stopCall();
    setStatus('idle');
    setMuted(false);
  };

  const handleToggleMute = async () => {
    if (!retellRef.current) return;
    const next = !muted;
    if (next) {
      retellRef.current.mute();
    } else {
      retellRef.current.unmute();
    }
    setMuted(next);
  };

  const statusLabelMap = {
    idle: 'Ready',
    connecting: 'Connecting...',
    in_call: 'Voice order active',
    listening: 'Listening...',
    thinking: 'Agent speaking...',
    error: 'Error'
  };
  const safeStatus = safeText(status, 'idle');

  return (
    <div className="voice-order-panel">
      <div className="voice-order-panel__content">
        <h3>Voice Order (Retell)</h3>
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
