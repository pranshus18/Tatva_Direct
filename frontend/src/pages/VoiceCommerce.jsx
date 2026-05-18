import React from 'react';
import { Mic, PhoneOff, Volume2 } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { normalizeUserType } from '../utils/userType';
import { useVoiceSession } from '../voice/useVoiceSession';
import './VoiceCommerce.css';

const VoiceCommerce = ({ user }) => {
  const userType = normalizeUserType(user?.userType);
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const {
    state,
    error,
    inCall,
    connected,
    lastReply,
    interimText,
    startSpeaking,
    endCall,
    doneSpeaking
  } = useVoiceSession(token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (userType && userType !== 'service_provider') {
    return <Navigate to="/" replace />;
  }

  const displayState = inCall && state === 'ready' ? 'listening' : state;

  const stateLabel = {
    connecting: 'Connecting…',
    ready: 'Tap Start speaking to begin',
    listening: interimText
      ? `Hearing: ${interimText}`
      : 'On call — speak your product name or request',
    thinking: 'On call — working on your request…',
    speaking: 'On call — agent is speaking…',
    error: 'Something went wrong',
    disconnected: 'Disconnected — refresh page'
  }[displayState] || displayState;

  const busy = state === 'thinking' || state === 'speaking';

  return (
    <div className="voice-page">
      <div className="voice-page__header">
        <h1>Voice shopping</h1>
        <p>
          {inCall ? (
            <>
              One call — pause after each answer. Steps: 1 Search → 2 Quantity → 3 Supplier → 4
              Substitution → 5 PO details → 6 Transport → 7 Confirm order. Say &quot;what&apos;s next&quot;
              anytime.
            </>
          ) : (
            'Tap Start speaking once. The call stays open for the full order.'
          )}
        </p>
      </div>

      {inCall ? (
        <p className="voice-call-badge" aria-live="polite">
          Call active — only End call hangs up. Pause after each step to continue.
        </p>
      ) : null}

      <div className={`voice-orb voice-orb--${inCall ? 'in-call' : displayState}`} aria-live="polite">
        <Volume2 size={28} />
        <span className="voice-orb__label">{stateLabel}</span>
      </div>

      <div className="voice-controls">
        {!inCall ? (
          <button
            type="button"
            className="voice-btn voice-btn--primary"
            onClick={startSpeaking}
            disabled={!connected || state === 'connecting'}
          >
            <Mic size={22} />
            Start speaking
          </button>
        ) : (
          <>
            <button
              type="button"
              className="voice-btn voice-btn--primary"
              onClick={doneSpeaking}
              disabled={busy}
            >
              <Mic size={22} />
              Done speaking
            </button>
            <button type="button" className="voice-btn voice-btn--stop" onClick={endCall} disabled={busy}>
              <PhoneOff size={22} />
              End call
            </button>
          </>
        )}
      </div>

      {error ? <p className="voice-error">{error}</p> : null}

      {lastReply ? (
        <div className="voice-hint" aria-label="Assistant response">
          <p>{lastReply}</p>
        </div>
      ) : null}
    </div>
  );
};

export default VoiceCommerce;
