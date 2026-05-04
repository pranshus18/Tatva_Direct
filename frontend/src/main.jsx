import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

// Register service worker (production only) for offline support
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}

// Log API configuration for debugging
const apiUrl = import.meta.env.VITE_API_BASE_URL || 'https://tatvadirect.onrender.com (default)';
console.log('API Base URL:', apiUrl);
console.log('Environment:', import.meta.env.MODE);
console.log('All env vars:', import.meta.env);

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error('Root element not found!');
  document.body.innerHTML = `
    <div style="padding: 20px; font-family: sans-serif;">
      <h1>Application Error</h1>
      <p>Root element (#root) not found in HTML.</p>
    </div>
  `;
} else {
  try {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    );
  } catch (error) {
    console.error('Error rendering app:', error);
    rootElement.innerHTML = `
      <div style="padding: 20px; font-family: sans-serif;">
        <h1>Application Error</h1>
        <p>There was an error loading the application.</p>
        <p style="color: red;">${error.message}</p>
        <p>Please check the browser console for more details.</p>
        <pre style="background: #f5f5f5; padding: 10px; margin-top: 10px; overflow: auto;">
          ${error.stack || JSON.stringify(error, null, 2)}
        </pre>
      </div>
    `;
  }
}
