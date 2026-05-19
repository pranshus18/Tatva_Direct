import React from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { normalizeUserType } from '../utils/userType';
import { useVoiceSessionContext } from '../voice/VoiceSessionContext';
import { VoiceAssistantOrb } from '../voice/VoiceAssistantOrb.jsx';
import './VoiceCommerce.css';

const VoiceCommerce = ({ user }) => {
  const userType = normalizeUserType(user?.userType);
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const session = useVoiceSessionContext();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  if (userType && userType !== 'service_provider') {
    return <Navigate to="/" replace />;
  }

  if (!session) {
    return (
      <div className="voice-page">
        <p className="voice-error">Voice session is loading… refresh if this persists.</p>
      </div>
    );
  }

  const {
    state,
    error,
    inCall,
    connected,
    voiceScreen,
    startSpeaking,
    endCall
  } = session;

  const displayState = inCall && state === 'ready' ? 'listening' : state;

  const stateLabel = {
    connecting: 'Connecting…',
    ready: 'Tap Start speaking',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    error: 'Something went wrong',
    disconnected: 'Disconnected'
  }[displayState] || displayState;

  const busy = state === 'thinking' || state === 'speaking';
  const micActive = inCall && displayState === 'listening';

  return (
    <div className="voice-page">
      <div className="voice-page__header">
        <h1>Voice shopping</h1>
      </div>

      <VoiceAssistantOrb
        micActive={micActive}
        agentSpeaking={displayState === 'speaking'}
        caption={voiceScreen || stateLabel}
        className="voice-page__orb"
      />

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
          <button type="button" className="voice-btn voice-btn--stop" onClick={endCall} disabled={busy}>
            <PhoneOff size={22} />
            End call
          </button>
        )}
      </div>

      {error ? <p className="voice-error">{error}</p> : null}
    </div>
  );
};

export default VoiceCommerce;
