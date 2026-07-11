import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

const Layout = () => {
  useEffect(() => {
    const title: string = 'AI 知识付费直播复盘';
    document.title = title;
    const timer: number = window.setTimeout(() => {
      document.title = title;
    }, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background">
              复
            </div>
            <div>
              <p className="text-sm font-semibold">AI 知识付费直播复盘</p>
              <p className="text-xs text-muted-foreground">
                找风险 · 看节奏 · 拿改稿
              </p>
            </div>
          </div>
          <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
            单场复盘
          </span>
        </div>
      </header>
      <Outlet />
    </div>
  );
};

export default Layout;
