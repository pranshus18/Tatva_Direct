import React from 'react';
import { Mic } from 'lucide-react';
import { isVoiceGuidedActive, getVoiceGuidedLabel } from '../voice/voiceCartBridge';
import './VoiceGuidedBanner.css';

const VoiceGuidedBanner = () => {
  if (!isVoiceGuidedActive()) return null;
  const label = getVoiceGuidedLabel();
  return (
    <div className="voice-guided-banner" role="status">
      <Mic size={18} aria-hidden="true" />
      <span>
        Voice assistant is guiding this step
        {label ? ` — ${label}` : ''}. Speak naturally; tap End call on the bar below to hang up.
      </span>
    </div>
  );
};

export default VoiceGuidedBanner;
