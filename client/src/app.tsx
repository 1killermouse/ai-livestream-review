import React from 'react';
import { Route, Routes } from 'react-router-dom';

import Layout from './components/Layout';
import DashboardPage from './pages/dashboard/DashboardPage';
import NotFound from './pages/NotFound/NotFound';

const RoutesComponent = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default RoutesComponent;
