import React from 'react';

const ProgressBar = ({ progress, showLabel = true, height = 8 }) => {
  return (
    <div style={{ width: '100%' }}>
      {showLabel && (
        <div style={{ 
          fontSize: '0.75rem', 
          color: '#64748b', 
          marginBottom: '0.5rem',
          fontWeight: '600'
        }}>
          {Math.round(progress)}% Complete
        </div>
      )}
      <div style={{ 
        background: '#e2e8f0', 
        borderRadius: height / 2, 
        height: `${height}px`,
        overflow: 'hidden'
      }}>
        <div 
          style={{ 
            width: `${progress}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #4f46e5, #7c3aed)',
            borderRadius: height / 2,
            transition: 'width 0.3s ease'
          }}
        />
      </div>
    </div>
  );
};

export default ProgressBar;