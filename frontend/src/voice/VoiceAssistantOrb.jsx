import React from 'react';
import orbImg from '../images/voice-assistant-single.png';
import { useMicLevel } from './useMicLevel.js';
import './VoiceAssistantOrb.css';

/**
 * One fixed orb image — no sprite frames. Rotates in place when user or agent speaks.
 */
export function VoiceAssistantOrb({
  micActive = false,
  agentSpeaking = false,
  caption,
  className = ''
}) {
  const { level, isSpeaking } = useMicLevel(micActive);
  const isAnimating = agentSpeaking || (micActive && isSpeaking);

  return (
    <div
      className={`voice-assistant-orb ${isAnimating ? 'voice-assistant-orb--live' : ''} ${className}`.trim()}
      style={isAnimating ? { '--voice-level': level } : undefined}
    >
      <div className="voice-assistant-orb__stage">
        <img
          src={orbImg}
          alt=""
          className="voice-assistant-orb__img"
          draggable={false}
        />
      </div>
      {caption ? <p className="voice-assistant-orb__caption">{caption}</p> : null}
    </div>
  );
}

export default VoiceAssistantOrb;
