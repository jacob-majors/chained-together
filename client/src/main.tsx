import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  // Strict mode removed intentionally: double-mounting would double-init
  // the Three.js renderer and physics world in development.
  <App />
);
