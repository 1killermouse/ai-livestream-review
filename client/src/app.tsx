import React from 'react';
import { Route, Routes } from 'react-router-dom';

import { AuthProvider } from './auth/AuthProvider';
import Layout from './components/Layout';
import DashboardPage from './pages/dashboard/DashboardPage';
import HistoryPage from './pages/history/HistoryPage';
import NotFound from './pages/NotFound/NotFound';

const RoutesComponent = () => {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="history" element={<HistoryPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
};

export default RoutesComponent;
