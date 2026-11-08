import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store';
import './styles.css';

const el = document.getElementById('root');
if (!el) throw new Error('index.html is missing the #root element.');

// Phase 5: keep a `system` user in step with the OS. Registered here (not in a
// React effect) so it exists for the whole session and never double-binds under
// StrictMode. The store ignores the event for an explicit dark/light choice.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => useStore.getState().syncSystemTheme();
  if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
  else if (typeof mq.addListener === 'function') mq.addListener(onChange);
}

createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
