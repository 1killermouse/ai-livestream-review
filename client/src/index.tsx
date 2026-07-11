import React from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import RoutesComponent from './app.tsx';
import './index.css';
import { Toaster } from '@client/src/components/ui/sonner';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';

const MainApp = () => {
  return (
    <BrowserRouter
      basename={CLIENT_BASE_PATH}
      future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
    >
      <ErrorBoundary
        fallbackRender={({ resetErrorBoundary }) => (
          <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
            <div className="max-w-md text-center">
              <p className="text-xl font-semibold">页面暂时没有加载成功</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                请重新加载页面。如果问题持续出现，可以检查本地开发服务日志。
              </p>
              <button
                type="button"
                className="mt-5 min-h-9 rounded-md border border-primary-border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                onClick={resetErrorBoundary}
              >
                重新加载
              </button>
            </div>
          </main>
        )}
      >
        <RoutesComponent />
        {createPortal(<Toaster />, document.body)}
      </ErrorBoundary>
    </BrowserRouter>
  );
};

createRoot(document.getElementById('root')!).render(<MainApp />);
