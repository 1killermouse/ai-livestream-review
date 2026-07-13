import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { AxiosError } from 'axios';
import { KeyRound, RefreshCw, ShieldCheck } from 'lucide-react';

import { auth } from '@/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  AuthStatusResponse,
  BootstrapAccountRequest,
  InternalUser,
  LoginRequest,
} from '@shared/api.interface';

interface AuthContextValue {
  user: InternalUser;
  logout: () => Promise<void>;
}

interface ApiErrorBody {
  error?: {
    message?: string;
  };
  message?: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getErrorMessage(error: unknown, fallback: string): string {
  const axiosError = error as AxiosError<ApiErrorBody>;
  return (
    axiosError.response?.data?.error?.message ||
    axiosError.response?.data?.message ||
    fallback
  );
}

const LoadingScreen: React.FC = () => (
  <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <RefreshCw className="size-4 animate-spin" />
      正在打开主播复盘台
    </div>
  </main>
);

interface AccountFormProps {
  initialized: boolean;
  onAuthenticated: (user: InternalUser) => void;
}

const AccountForm: React.FC<AccountFormProps> = ({
  initialized,
  onAuthenticated,
}) => {
  const [username, setUsername] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');

    try {
      const user: InternalUser = initialized
        ? await auth.login({ username, password } satisfies LoginRequest)
        : await auth.bootstrap({
            username,
            displayName,
            password,
          } satisfies BootstrapAccountRequest);
      onAuthenticated(user);
    } catch (error: unknown) {
      setErrorMessage(
        getErrorMessage(
          error,
          initialized
            ? '登录没有成功，请重新检查。'
            : '账号创建没有成功，请重试。',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-background text-foreground lg:grid-cols-[minmax(0,1fr)_minmax(28rem,38rem)]">
      <section className="hidden border-r border-border bg-muted/20 p-12 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-foreground font-semibold text-background">
            复
          </div>
          <div>
            <p className="font-semibold">AI 知识付费直播复盘</p>
          </div>
        </div>
        <div className="max-w-xl">
          <ShieldCheck className="size-8 text-primary" />
          <h1 className="mt-5 text-3xl font-semibold tracking-normal">
            播后不复盘，直播就是背稿子
          </h1>
        </div>
        <div />
      </section>

      <section className="flex items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-9 flex items-center gap-3 lg:hidden">
            <div className="flex size-9 items-center justify-center rounded-md bg-foreground text-sm font-semibold text-background">
              复
            </div>
            <p className="text-sm font-semibold">AI 知识付费直播复盘</p>
          </div>
          <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-normal">
            {initialized ? '登录主播复盘台' : '创建第一个管理账号'}
          </h2>

          {errorMessage ? (
            <Alert variant="destructive" className="mt-5">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
            {!initialized ? (
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="display-name">
                  管理员名称
                </label>
                <Input
                  id="display-name"
                  value={displayName}
                  autoComplete="name"
                  maxLength={40}
                  required
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="例如：张永"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="username">
                登录账号
              </label>
              <Input
                id="username"
                value={username}
                autoComplete="username"
                minLength={3}
                maxLength={32}
                required
                onChange={(event) => setUsername(event.target.value)}
                placeholder="例如：zhangyong"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="password">
                登录密码
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                autoComplete={initialized ? 'current-password' : 'new-password'}
                minLength={8}
                maxLength={128}
                required
                onChange={(event) => setPassword(event.target.value)}
                placeholder="至少 8 位"
              />
            </div>
            <Button className="w-full" type="submit" disabled={submitting}>
              {submitting
                ? initialized
                  ? '正在登录'
                  : '正在创建'
                : initialized
                  ? '登录'
                  : '创建并进入'}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
};

export const AuthProvider: React.FC<React.PropsWithChildren> = ({
  children,
}) => {
  const [status, setStatus] = useState<AuthStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<string>('');

  const loadStatus = useCallback(async (): Promise<void> => {
    setLoadError('');
    try {
      setStatus(await auth.getStatus());
    } catch {
      setLoadError('账号服务暂时没有准备好，请重新加载。');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleLogout = useCallback(async (): Promise<void> => {
    await auth.logout();
    setStatus((current: AuthStatusResponse | null) => ({
      initialized: current?.initialized ?? true,
      authenticated: false,
    }));
  }, []);

  const contextValue: AuthContextValue | null = useMemo(
    () =>
      status?.user
        ? {
            user: status.user,
            logout: handleLogout,
          }
        : null,
    [handleLogout, status?.user],
  );

  if (loadError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-5 text-foreground">
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold">暂时无法打开账号服务</p>
          <p className="mt-2 text-sm text-muted-foreground">{loadError}</p>
          <Button
            className="mt-5"
            variant="outline"
            onClick={() => void loadStatus()}
          >
            <RefreshCw className="size-4" />
            重新加载
          </Button>
        </div>
      </main>
    );
  }

  if (!status) {
    return <LoadingScreen />;
  }

  if (!status.authenticated || !status.user) {
    return (
      <AccountForm
        initialized={status.initialized}
        onAuthenticated={(user: InternalUser) =>
          setStatus({ initialized: true, authenticated: true, user })
        }
      />
    );
  }

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const context: AuthContextValue | null = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 中使用');
  }
  return context;
}
