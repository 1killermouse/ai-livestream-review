import { useEffect, useMemo, useState } from 'react';
import type { AxiosError } from 'axios';
import {
  AlertCircle,
  ChevronRight,
  FileClock,
  PlusCircle,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { history as historyApi } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  HistoryReportListResponse,
  HistoryReportSummary,
} from '@shared/api.interface';

interface ApiErrorBody {
  error?: { message?: string };
}

const formatDuration = (seconds: number): string => {
  const totalMinutes: number = Math.max(0, Math.round(seconds / 60));
  const hours: number = Math.floor(totalMinutes / 60);
  const minutes: number = totalMinutes % 60;
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`;
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));

const scoreTone = (score: number): string => {
  if (score >= 80) return 'text-success';
  if (score >= 60) return 'text-warning';
  return 'text-destructive';
};

const HistoryPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [result, setResult] = useState<HistoryReportListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [query, setQuery] = useState<string>('');

  const loadReports = async (): Promise<void> => {
    setLoading(true);
    setErrorMessage('');
    try {
      setResult(await historyApi.listReports());
    } catch (error: unknown) {
      const axiosError = error as AxiosError<ApiErrorBody>;
      setErrorMessage(
        axiosError.response?.data?.error?.message ||
          '历史记录暂时没有加载成功，请重新试一次。',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReports();
  }, []);

  const filteredReports: HistoryReportSummary[] = useMemo(() => {
    const keyword: string = query.trim().toLowerCase();
    if (!keyword) return result?.items || [];
    return (result?.items || []).filter((item: HistoryReportSummary) =>
      [
        item.title,
        item.frameworkName,
        item.owner.displayName,
        item.owner.username,
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword),
    );
  }, [query, result?.items]);

  const highRiskTotal: number = useMemo(
    () =>
      (result?.items || []).reduce(
        (total: number, item: HistoryReportSummary) =>
          total + item.highRiskFindings,
        0,
      ),
    [result?.items],
  );

  const averageScore: number = useMemo(() => {
    const items: HistoryReportSummary[] = result?.items || [];
    if (items.length === 0) return 0;
    return Math.round(
      items.reduce(
        (total: number, item: HistoryReportSummary) => total + item.score,
        0,
      ) / items.length,
    );
  }, [result?.items]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
      <section className="flex flex-col justify-between gap-5 border-b border-border pb-6 sm:flex-row sm:items-end">
        <div>
          <Badge variant="secondary">
            {user.role === 'admin' ? '全部主播' : '我的直播'}
          </Badge>
          <h1 className="mt-3 text-3xl font-semibold tracking-normal">
            历史复盘
          </h1>
        </div>
        <Button type="button" onClick={() => navigate('/')}>
          <PlusCircle className="size-4" />
          新建复盘
        </Button>
      </section>

      {errorMessage ? (
        <Alert variant="destructive" className="mt-6">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{errorMessage}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadReports()}
            >
              <RefreshCw className="size-4" />
              重新加载
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="mt-7 space-y-3">
          <Skeleton className="h-11 w-full max-w-md" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : result && result.items.length > 0 ? (
        <section className="mt-7">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <dl className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3 lg:min-w-[36rem]">
              <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
                <dt className="text-xs font-medium text-muted-foreground">
                  复盘总数
                </dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">
                  {result.total}
                </dd>
              </div>
              <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
                <dt className="text-xs font-medium text-muted-foreground">
                  平均安全分
                </dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-primary">
                  {averageScore}
                </dd>
              </div>
              <div className="px-4 py-3">
                <dt className="text-xs font-medium text-muted-foreground">
                  高风险原话
                </dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-destructive">
                  {highRiskTotal}
                </dd>
              </div>
            </dl>
            <div className="relative w-full sm:max-w-sm">
              <label className="sr-only" htmlFor="history-search">
                搜索历史复盘
              </label>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="history-search"
                type="search"
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={
                  user.role === 'admin'
                    ? '搜索报告或主播'
                    : '搜索报告名称或分析框架'
                }
              />
            </div>
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            <div className="hidden grid-cols-[minmax(0,2fr)_8rem_8rem_7rem_2rem] gap-4 border-b border-border bg-muted/55 px-4 py-3 text-xs font-medium text-muted-foreground md:grid">
              <span>直播报告</span>
              <span>{user.role === 'admin' ? '所属主播' : '直播时长'}</span>
              <span>分析时间</span>
              <span>安全分</span>
              <span />
            </div>
            {filteredReports.map((item: HistoryReportSummary) => (
              <button
                key={item.id}
                type="button"
                className="grid w-full min-w-0 cursor-pointer gap-3 border-b border-border px-4 py-4 text-left transition-colors duration-200 last:border-b-0 hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/20 md:grid-cols-[minmax(0,2fr)_8rem_8rem_7rem_2rem] md:items-center md:gap-4"
                onClick={() => navigate(`/?report=${item.id}`)}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {item.title}
                    </span>
                    {item.highRiskFindings > 0 ? (
                      <Badge variant="destructive">
                        {item.highRiskFindings} 处高风险
                      </Badge>
                    ) : (
                      <Badge variant="secondary">未发现高风险</Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {item.frameworkName} · {item.transcriptWordCount} 字
                  </p>
                </div>
                <div className="text-xs">
                  <span className="mr-2 text-muted-foreground md:hidden">
                    {user.role === 'admin' ? '主播' : '时长'}
                  </span>
                  {user.role === 'admin'
                    ? item.owner.displayName
                    : formatDuration(item.durationSeconds)}
                </div>
                <div className="text-xs">
                  <span className="mr-2 text-muted-foreground md:hidden">
                    分析时间
                  </span>
                  {formatDate(item.createdAt)}
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground md:hidden">
                    安全分
                  </span>
                  <span
                    className={`text-base font-semibold ${scoreTone(item.score)}`}
                  >
                    {item.score}
                  </span>
                  <span className="text-muted-foreground">/ 100</span>
                </div>
                <ChevronRight className="hidden size-4 text-muted-foreground md:block" />
              </button>
            ))}
          </div>

          {filteredReports.length === 0 ? (
            <div className="mt-8 text-center text-sm text-muted-foreground">
              没有找到匹配的复盘记录
            </div>
          ) : null}
        </section>
      ) : !errorMessage ? (
        <Empty className="mt-12 min-h-72 border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileClock className="size-5" />
            </EmptyMedia>
            <EmptyTitle>还没有历史复盘</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={() => navigate('/')}>
              <PlusCircle className="size-4" />
              开始第一场复盘
            </Button>
          </EmptyContent>
        </Empty>
      ) : null}
    </main>
  );
};

export default HistoryPage;
