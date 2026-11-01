import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts.css';
import './theme.css';
import App from './App';
import { registerWorker } from './offline';

// Loaded up front, so a first sudoku note does not flash in a fallback font.
for (const family of ['Press Start 2P', 'VT323', 'IBM Plex Mono']) {
  void document.fonts.load(`16px '${family}'`);
}

if (import.meta.env.PROD) registerWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
