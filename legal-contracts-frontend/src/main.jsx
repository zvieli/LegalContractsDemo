import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { EthersProvider } from './contexts/EthersContext';
import { NotificationProvider } from './contexts/NotificationContext';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <EthersProvider>
      <NotificationProvider>
        <App />
      </NotificationProvider>
    </EthersProvider>
  </React.StrictMode>
);