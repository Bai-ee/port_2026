import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './AuthContext';
import AppRouter from './AppRouter';
import './colors.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  </React.StrictMode>
);
