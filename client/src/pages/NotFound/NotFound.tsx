import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';

const NotFound = () => {
  return (
    <main className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6">
      <div className="text-center">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">
          没有找到这个页面
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          返回直播复盘首页，重新提交一场直播。
        </p>
        <Button className="mt-5" asChild>
          <Link to="/">
            <ArrowLeft className="size-4" />
            返回首页
          </Link>
        </Button>
      </div>
    </main>
  );
};

export default NotFound;
