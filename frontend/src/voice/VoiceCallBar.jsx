import React from 'react';
import { PhoneOff } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useVoiceSessionContext } from './VoiceSessionContext.jsx';
import agentGif from '../images/agent.gif';
import { isVoiceGuidedActive, getVoiceGuidedLabel } from './voiceCartBridge.js';
import './VoiceCallBar.css';

const VoiceCallBar = () => {
  const location = useLocation();
  const ctx = useVoiceSessionContext();

  React.useEffect(() => {
    if (ctx?.inCall) {
      document.body.classList.add('voice-call-active');
    } else {
      document.body.classList.remove('voice-call-active');
    }
    return () => document.body.classList.remove('voice-call-active');
  }, [ctx?.inCall]);

  if (!ctx?.inCall) return null;

  const onVoicePage = location.pathname === '/voice';
  const { state, error, voiceScreen, endCall } = ctx;

  const displayState = state === 'ready' ? 'listening' : state;
  const busy = state === 'thinking' || state === 'speaking';
  const stepLabel =
    voiceScreen || (isVoiceGuidedActive() ? getVoiceGuidedLabel() : '') || 'Voice assistant active';

  const stateLabel = {
    connecting: 'Connecting…',
    ready: 'Listening…',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…',
    error: 'Error',
    disconnected: 'Disconnected'
  }[displayState] || displayState;

  if (onVoicePage) {
    return (
      <div className="voice-call-bar voice-call-bar--inline" aria-live="polite">
        <span className="voice-call-bar__step">{stepLabel}</span>
        <span className="voice-call-bar__state"> · {stateLabel}</span>
      </div>
    );
  }

  return (
    <div className="voice-call-bar" role="region" aria-label="Voice assistant call">
      <img src={agentGif} alt="" className="voice-call-bar__orb" aria-hidden="true" />
      <div className="voice-call-bar__meta">
        <strong>{stepLabel}</strong>
        <span>{stateLabel}</span>
        {error ? <span className="voice-call-bar__error">{error}</span> : null}
      </div>
      <div className="voice-call-bar__actions">
        <button
          type="button"
          className="voice-call-bar__btn voice-call-bar__btn--stop"
          onClick={endCall}
          disabled={busy}
        >
          <PhoneOff size={18} />
          End call
        </button>
      </div>
    </div>
  );
};

export default VoiceCallBar;
