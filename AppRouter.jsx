import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AuthPage from './AuthPage';
import DashboardPage from './DashboardPage';
import HomePage from './HomePage.jsx';
import ProtectedRoute from './ProtectedRoute';

const AppRouter = () => (
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </BrowserRouter>
);

export default AppRouter;
