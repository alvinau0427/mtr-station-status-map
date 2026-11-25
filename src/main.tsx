import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { getSnapshot } from './services/snapshotApi';
import './index.css';

// Start the snapshot request before React mounts so the first render already
// has data. The static splash in index.html covers this brief window.
getSnapshot().catch(() => undefined).then((initialSnapshot) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App initialSnapshot={initialSnapshot} />
      </ErrorBoundary>
    </React.StrictMode>,
  );
});
