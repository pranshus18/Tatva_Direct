import React, { createContext, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVoiceSession } from './useVoiceSession';
import { applyVoiceNavigation } from './applyVoiceNavigation.js';
import { setVoiceGuidedActive } from './voiceCartBridge.js';
import VoiceCallBar from './VoiceCallBar.jsx';

const VoiceSessionContext = createContext(null);

export function VoiceSessionProvider({ children, token }) {
  const navigate = useNavigate();

  const onNavigate = useMemo(
    () => (payload) => {
      void applyVoiceNavigation(navigate, payload);
    },
    [navigate]
  );

  const session = useVoiceSession(token, { onNavigate });

  const value = useMemo(() => {
    const endCall = () => {
      setVoiceGuidedActive(false);
      session.endCall();
    };
    return { ...session, endCall };
  }, [session]);

  return (
    <VoiceSessionContext.Provider value={value}>
      {children}
      <VoiceCallBar />
    </VoiceSessionContext.Provider>
  );
}

export function useVoiceSessionContext() {
  return useContext(VoiceSessionContext);
}
