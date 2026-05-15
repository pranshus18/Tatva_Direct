import React from 'react';
import { Mic, MicOff, Volume2 } from 'lucide-react';
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
    listening,
    lastReply,
    interimText,
    startListening,
    stopListening
  } = useVoiceSession(token);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (userType && userType !== 'service_provider') {
    return <Navigate to="/" replace />;
  }

  const stateLabel = {
    connecting: 'Connecting…',
    listening: listening
      ? interimText
        ? `Hearing: ${interimText}`
        : 'Listening — speak now'
      : 'Tap microphone to speak',
    thinking: 'Processing…',
    speaking: 'Speaking…',
    confirm: 'Please confirm',
    error: 'Error',
    disconnected: 'Disconnected'
  }[state] || state;

  return (
    <div className="voice-page">
      <div className="voice-page__header">
        <h1>Voice shopping</h1>
        <p>Integrated with your backend — modular files under frontend/src/voice/</p>
      </div>

      <div className={`voice-orb voice-orb--${state}`} aria-live="polite">
        <Volume2 size={28} />
        <span className="voice-orb__label">{stateLabel}</span>
      </div>

      <div className="voice-controls">
        {!listening ? (
          <button
            type="button"
            className="voice-btn voice-btn--primary"
            onClick={startListening}
            disabled={state === 'connecting'}
          >
            <Mic size={22} />
            Start speaking
          </button>
        ) : (
          <button type="button" className="voice-btn voice-btn--stop" onClick={stopListening}>
            <MicOff size={22} />
            Done speaking
          </button>
        )}
      </div>

      {error ? <p className="voice-error">{error}</p> : null}

      {lastReply ? (
        <div className="voice-hint" aria-label="Assistant response summary">
          <p>{lastReply}</p>
        </div>
      ) : null}
    </div>
  );
};

export default VoiceCommerce;
