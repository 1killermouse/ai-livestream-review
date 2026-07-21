import React, { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';

import { AuthProvider } from './auth/AuthProvider';
import Layout from './components/Layout';
import NotFound from './pages/NotFound/NotFound';

const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const HistoryPage = lazy(() => import('./pages/history/HistoryPage'));

const PageLoading: React.FC = () => (
  <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
    正在打开...
  </div>
);

const RoutesComponent = () => {
  return (
    <AuthProvider>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="history" element={<HistoryPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
};

export default RoutesComponent;
