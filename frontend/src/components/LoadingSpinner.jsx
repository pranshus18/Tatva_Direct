import React from 'react';

const LoadingSpinner = ({ size = 40, color = '#4f46e5' }) => {
  return (
    <div 
      style={{
        width: size,
        height: size,
        border: `3px solid rgba(79, 70, 229, 0.1)`,
        borderTop: `3px solid ${color}`,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        display: 'inline-block'
      }}
    />
  );
};

export default LoadingSpinner;