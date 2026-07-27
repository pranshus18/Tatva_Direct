import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { getApiUrl } from '../config/api';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import { fetchVoiceCartDraft, isVoiceGuidedActive } from '../voice/voiceCartBridge';
import SpWorkflowPage from '../components/sp/SpWorkflowPage';
import { RefreshCw } from 'lucide-react';
import { clearCheckoutHoldExpired, SP_PO_CHECKOUT_HOLD_EXPIRED_KEY } from '../utils/checkoutReservation';
import './Substitution.css';

const Substitution = ({ selectedVendors, onComplete, items }) => {
  const [suggestions, setSuggestions] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [hasFetchedSuggestions, setHasFetchedSuggestions] = useState(false);
  const [substitutionsFetchFailed, setSubstitutionsFetchFailed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const didAutoSkipRef = useRef(false);
  const [voiceCart, setVoiceCart] = useState(null);
  const voiceGuided = isVoiceGuidedActive();

  const workflowItems = voiceCart?.items?.length ? voiceCart.items : items;
  const workflowVendors =
    voiceCart?.selectedVendors && Object.keys(voiceCart.selectedVendors).length
      ? voiceCart.selectedVendors
      : selectedVendors;

  useEffect(() => {
    if (!voiceGuided) return;
    let cancelled = false;
    fetchVoiceCartDraft().then((draft) => {
      if (!cancelled) setVoiceCart(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [voiceGuided, location.state?.voiceNavSeq]);

  useEffect(() => {
    if (workflowItems && workflowItems.length > 0) {
      fetchSubstitutions();
    }
  }, [workflowVendors, workflowItems]);

  const fetchSubstitutions = async () => {
    const token = localStorage.getItem('token');
    
    try {
      setLoadingSuggestions(true);
      setHasFetchedSuggestions(false);
      setSubstitutionsFetchFailed(false);
      const res = await fetch(getApiUrl('/api/substitutions/suggest'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ selectedVendors: workflowVendors, items: workflowItems })
      });
      const data = await res.json();
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch (error) {
      console.error('Failed to fetch substitutions:', error);
      setSubstitutionsFetchFailed(true);
      setSuggestions([]);
    } finally {
      setHasFetchedSuggestions(true);
      setLoadingSuggestions(false);
    }
  };

  // If backend has no substitution suggestions, skip straight to PO creation.
  useEffect(() => {
    if (didAutoSkipRef.current) return;
    if (!hasFetchedSuggestions || loadingSuggestions) return;
    if (!workflowItems || workflowItems.length === 0) return;
    if (substitutionsFetchFailed) return;
    if (suggestions.length === 0) {
      didAutoSkipRef.current = true;
      onComplete([]);
      clearCheckoutHoldExpired(SP_PO_CHECKOUT_HOLD_EXPIRED_KEY);
      // Replace so browser Back from Create PO returns to Supplier Selection
      // instead of re-entering this auto-skip and trapping the user.
      navigate('/create-po', { replace: true });
    }
  }, [hasFetchedSuggestions, loadingSuggestions, suggestions, workflowItems, substitutionsFetchFailed, onComplete, navigate]);

  const handleDecision = (id, approved) => {
    setDecisions({ ...decisions, [id]: approved });
  };

  const handleProceed = () => {
    const approved = suggestions.filter(s => decisions[s.id] === true);
    onComplete(approved);
    clearCheckoutHoldExpired(SP_PO_CHECKOUT_HOLD_EXPIRED_KEY);
    navigate('/create-po');
  };

  return (
    <SpWorkflowPage title="Substitution" description="Review AI-recommended alternatives to optimize cost and availability" icon={RefreshCw}>
    <div className="page !p-0">
      <VoiceGuidedBanner />

      {suggestions.length === 0 ? (
        <div className="empty-state">
          <p>No substitution suggestions available</p>
          <button className="btn-primary" onClick={handleProceed}>
            Skip to Create PO
          </button>
        </div>
      ) : (
        <>
          <div className="substitution-list">
            {suggestions.map((sub) => (
              <div key={sub.id} className="substitution-card">
                <div className="sub-comparison">
                  <div className="sub-item original">
                    <span className="label">Original</span>
                    <h4>{sub.originalItem}</h4>
                    <div className="sub-meta">
                      <span>{sub.originalPrice}</span>
                      <span>{sub.originalLeadTime} days</span>
                    </div>
                  </div>
                  <div className="arrow">→</div>
                  <div className="sub-item suggested">
                    <span className="label">Suggested</span>
                    <h4>{sub.suggestedItem}</h4>
                    <div className="sub-meta">
                      <span>{sub.suggestedPrice}</span>
                      <span>{sub.suggestedLeadTime} days</span>
                    </div>
                    <div className="savings">
                      Save {sub.savings || (sub.originalPrice - sub.suggestedPrice)} ({sub.savingsPercent || 0}%)
                    </div>
                  </div>
                </div>
                <div className="sub-actions">
                  <button 
                    className={`btn-action approve ${decisions[sub.id] === true ? 'active' : ''}`}
                    onClick={() => handleDecision(sub.id, true)}
                  >
                    <Check size={18} />
                    Approve
                  </button>
                  <button 
                    className={`btn-action reject ${decisions[sub.id] === false ? 'active' : ''}`}
                    onClick={() => handleDecision(sub.id, false)}
                  >
                    <X size={18} />
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn-primary btn-large" onClick={handleProceed}>
            Proceed to Create PO
          </button>
        </>
      )}
    </div>
    </SpWorkflowPage>
  );
};

export default Substitution;
