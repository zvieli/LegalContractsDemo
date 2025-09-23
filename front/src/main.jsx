import './polyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { EthersProvider } from './contexts/EthersContext';
import { NotificationProvider } from './contexts/NotificationContext';
import './styles/globals.css';
import { loadAbis } from './utils/loadAbis';

async function bootstrap() {
  try {
    await loadAbis();
  } catch (e) {
    // proceed regardless; contracts.js will still attempt other fallbacks
    console.warn('Failed loading ABIs early:', e);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <EthersProvider>
        <NotificationProvider>
          <App />
        </NotificationProvider>
      </EthersProvider>
    </React.StrictMode>
  );
}

bootstrap();