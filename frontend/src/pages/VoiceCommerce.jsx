import React from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { normalizeUserType } from '../utils/userType';
import { useVoiceSessionContext } from '../voice/VoiceSessionContext';
import { VoiceAssistantOrb } from '../voice/VoiceAssistantOrb.jsx';
import { voiceText } from '../voice/voiceText.js';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
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
    voiceLanguage,
    interimText,
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
    <SpPageLayout>
    <div className="voice-page mx-auto max-w-lg">
      <SpPageHeader title="Voice shopping" description="Shop hands-free with voice commands" icon={Mic} className="!border-0 !pb-2" />

      <VoiceAssistantOrb
        micActive={micActive}
        agentSpeaking={displayState === 'speaking'}
        caption={voiceScreen || stateLabel}
        className="voice-page__orb"
      />

      {inCall && interimText ? (
        <p className="voice-heard" aria-live="polite">
          <span className="voice-heard__label">
            {voiceText(voiceLanguage, 'ui.heardYouSay', {}, 'I heard:')}
          </span>{' '}
          {interimText}
        </p>
      ) : null}

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
    </SpPageLayout>
  );
};

export default VoiceCommerce;
