import { useEffect, useState } from 'react';
import type { AxiosError } from 'axios';
import {
  CheckCircle2,
  History,
  LogOut,
  PlusCircle,
  UserPlus,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

import { auth } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface ApiErrorBody {
  error?: { message?: string };
  message?: string;
}

const CreateAnchorDialog = () => {
  const [open, setOpen] = useState<boolean>(false);
  const [username, setUsername] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  const resetForm = (): void => {
    setUsername('');
    setDisplayName('');
    setPassword('');
    setErrorMessage('');
    setSuccessMessage('');
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const account = await auth.createAccount({
        username,
        displayName,
        password,
        role: 'anchor',
      });
      setSuccessMessage(
        `${account.displayName} 的账号已创建，可以把登录账号和密码发给主播。`,
      );
      setPassword('');
    } catch (error: unknown) {
      const axiosError = error as AxiosError<ApiErrorBody>;
      setErrorMessage(
        axiosError.response?.data?.error?.message ||
          axiosError.response?.data?.message ||
          '主播账号没有创建成功，请重新检查。',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen: boolean) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          resetForm();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <UserPlus className="size-4" />
          新增主播
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增主播账号</DialogTitle>
          <DialogDescription>
            主播使用这个账号登录后，只能看到自己的直播复盘。
          </DialogDescription>
        </DialogHeader>

        {successMessage ? (
          <Alert>
            <CheckCircle2 className="size-4 text-success" />
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        ) : null}
        {errorMessage ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="anchor-name">
              主播名称
            </label>
            <Input
              id="anchor-name"
              value={displayName}
              maxLength={40}
              required
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="例如：小雨老师"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="anchor-username">
              登录账号
            </label>
            <Input
              id="anchor-username"
              value={username}
              autoComplete="off"
              minLength={3}
              maxLength={32}
              required
              onChange={(event) => setUsername(event.target.value)}
              placeholder="例如：xiaoyu"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="anchor-password">
              初始密码
            </label>
            <Input
              id="anchor-password"
              type="password"
              value={password}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 位"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={submitting}>
              {submitting ? '正在创建' : '创建主播账号'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const Layout = () => {
  const { user, logout } = useAuth();

  useEffect(() => {
    const title: string = 'AI 知识付费直播复盘';
    document.title = title;
    const timer: number = window.setTimeout(() => {
      document.title = title;
    }, 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-50 -translate-y-20 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform focus:translate-y-0"
      >
        跳到主要内容
      </a>
      <header className="sticky top-0 z-20 border-b border-border bg-card shadow-xs">
        <div className="mx-auto flex min-h-16 w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground shadow-sm">
              复
            </div>
            <p className="max-w-36 text-sm font-semibold leading-5 sm:max-w-none">
              AI 知识付费直播复盘
            </p>
          </div>
          <nav
            aria-label="主要导航"
            className="order-3 flex w-full items-center gap-1 border-t border-border pt-2 sm:order-none sm:w-auto sm:border-0 sm:pt-0"
          >
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                'flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors duration-200 sm:flex-none ' +
                (isActive
                  ? 'bg-accent text-accent-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground')
              }
            >
              <PlusCircle className="size-4" />
              新建复盘
            </NavLink>
            <NavLink
              to="/history"
              className={({ isActive }) =>
                'flex min-h-10 flex-1 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors duration-200 sm:flex-none ' +
                (isActive
                  ? 'bg-accent text-accent-foreground shadow-xs'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground')
              }
            >
              <History className="size-4" />
              历史记录
            </NavLink>
          </nav>
          <div className="flex items-center gap-2">
            {user.role === 'admin' ? <CreateAnchorDialog /> : null}
            <div className="hidden items-center gap-2 border-l border-border pl-3 sm:flex">
              <p className="text-sm font-medium">{user.displayName}</p>
              <Badge variant="secondary">
                {user.role === 'admin' ? '管理员' : '主播'}
              </Badge>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              title="退出登录"
              aria-label="退出登录"
              onClick={() => void logout()}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <div id="main-content" tabIndex={-1}>
        <Outlet />
      </div>
    </div>
  );
};

export default Layout;
