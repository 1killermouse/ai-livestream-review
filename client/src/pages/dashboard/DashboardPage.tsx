import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  FileCheck2,
  FileText,
  Gauge,
  LayoutDashboard,
  Link2,
  ListChecks,
  MessageSquareText,
  Mic,
  PlayCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Video,
  WandSparkles,
} from 'lucide-react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import { useNavigate, useSearchParams } from 'react-router-dom';

import {
  analytics,
  analysis,
  feishu,
  history as historyApi,
  recorder,
  storage,
} from '@/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { buildDemoLiveDataReplay } from '@/data/demo-live-data';
import { buildDemoReport } from '@/data/demo-report';
import type {
  AnalysisCapability,
  BrowserRecordingUploadResult,
  FeishuSyncResult,
  FileAnalysisJob,
  FileUrlAnalysisRequest,
  FrameworkMatchSummary,
  HistoryReportDetail,
  InputSource,
  LiveDataInsight,
  LiveDataReplayResult,
  OssUploadResult,
  PrototypeAnalysisReport,
  RecorderCaptureResult,
  RecorderCaptureStatus,
  ReportChatMessage,
  ReportChatResponse,
  RiskLevel,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

type AnalysisMode = 'demo' | 'upload' | 'captured' | null;
type ReportView = 'overview' | 'risks' | 'rhythm' | 'data' | 'rewrite' | 'chat';

interface OutcomeItem {
  label: string;
  icon: React.ReactNode;
}

interface AnalysisProgressProps {
  mode: AnalysisMode;
  progress: number;
  uploading: boolean;
}

const DEFAULT_FRAMEWORK_NAME = 'AI 知识付费直播全场转化框架';
const ANALYSIS_JOB_POLL_INTERVAL_MS = 2000;
const ANALYSIS_JOB_MAX_ATTEMPTS = 300;
const MAX_RECORDING_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

const outcomeItems: OutcomeItem[] = [
  {
    label: '带时间点逐字稿',
    icon: <Clock3 className="size-4" />,
  },
  {
    label: '违禁与语义风险',
    icon: <ShieldAlert className="size-4" />,
  },
  {
    label: '直播节奏对照',
    icon: <Gauge className="size-4" />,
  },
  {
    label: '数据波动复盘',
    icon: <BarChart3 className="size-4" />,
  },
  {
    label: '可直接照读的改稿',
    icon: <WandSparkles className="size-4" />,
  },
  {
    label: '追问与飞书同步',
    icon: <MessageSquareText className="size-4" />,
  },
];

const liveDataChartConfig = {
  onlineUsers: {
    label: '在线人数',
    color: '#2563eb',
  },
  interactions: {
    label: '互动量',
    color: '#16a34a',
  },
} satisfies ChartConfig;

const formatTime = (seconds: number): string => {
  const minutes: number = Math.floor(seconds / 60);
  const remainder: number = seconds % 60;
  return (
    String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0')
  );
};

const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) {
    return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }
  if (bytes >= 1024 * 1024) {
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
};

const riskLabel = (level: RiskLevel): string => {
  const labels: Record<RiskLevel, string> = {
    critical: '严重',
    high: '高风险',
    medium: '中风险',
    low: '低风险',
  };
  return labels[level];
};

const riskVariant = (
  level: RiskLevel,
): 'destructive' | 'secondary' | 'outline' =>
  level === 'critical' || level === 'high'
    ? 'destructive'
    : level === 'medium'
      ? 'secondary'
      : 'outline';

const captureStatusLabel = (status: RecorderCaptureStatus): string => {
  const labels: Record<RecorderCaptureStatus, string> = {
    recording: '正在录制',
    completed: '录制完成',
    failed: '录制失败',
  };
  return labels[status];
};

const captureStatusVariant = (
  status: RecorderCaptureStatus,
): 'default' | 'secondary' | 'destructive' =>
  status === 'completed'
    ? 'default'
    : status === 'recording'
      ? 'secondary'
      : 'destructive';

const frameworkStatusLabel = (
  status: FrameworkMatchSummary['status'],
): string => {
  const labels: Record<FrameworkMatchSummary['status'], string> = {
    matched: '已覆盖',
    weak: '需要加强',
    missing: '缺失',
    not_applicable: '暂不判断',
  };
  return labels[status];
};

const frameworkStatusVariant = (
  status: FrameworkMatchSummary['status'],
): 'default' | 'secondary' | 'outline' | 'destructive' => {
  if (status === 'matched') {
    return 'default';
  }
  if (status === 'weak') {
    return 'secondary';
  }
  if (status === 'not_applicable') {
    return 'outline';
  }
  return 'destructive';
};

const findingTypeLabel = (finding: ScriptFinding): string => {
  if (finding.type === 'banned_word') {
    return '违禁词';
  }
  if (finding.type === 'semantic_risk') {
    return '语义风险';
  }
  return '节奏缺口';
};

const buildRiskScore = (report: PrototypeAnalysisReport): number => {
  const riskPenalty: number = report.findings.reduce(
    (total: number, finding): number => {
      const penalty: Record<RiskLevel, number> = {
        critical: 24,
        high: 18,
        medium: 9,
        low: 4,
      };
      return total + penalty[finding.riskLevel];
    },
    0,
  );
  const frameworkPenalty: number = report.frameworkMatches.reduce(
    (total: number, match): number => {
      if (match.status === 'missing') {
        return total + 8;
      }
      if (match.status === 'weak') {
        return total + 4;
      }
      return total;
    },
    0,
  );
  return Math.max(0, Math.min(100, 100 - riskPenalty - frameworkPenalty));
};

const scoreLabel = (score: number): string => {
  if (score >= 85) {
    return '整体较稳';
  }
  if (score >= 70) {
    return '还有优化空间';
  }
  if (score >= 50) {
    return '需要重点整改';
  }
  return '高风险内容较多';
};

const getTopRiskRules = (report: PrototypeAnalysisReport): string[] => {
  const highPriorityRules: string[] = report.findings
    .filter(
      (finding) =>
        finding.riskLevel === 'critical' || finding.riskLevel === 'high',
    )
    .map((finding) => finding.matchedRule.replace(/^DeepSeek 语义判断：/, ''));
  return Array.from(new Set(highPriorityRules)).slice(0, 3);
};

const buildKeepList = (report: PrototypeAnalysisReport): string[] => {
  const matchedStages: string[] = report.frameworkMatches
    .filter((match) => match.status === 'matched')
    .map((match) => match.stageName);
  if (matchedStages.length > 0) {
    return matchedStages.slice(0, 3);
  }
  return ['保留有实际内容的干货讲解', '保留清楚的课程权益说明'];
};

const buildAvoidList = (report: PrototypeAnalysisReport): string[] => {
  const risks: string[] = getTopRiskRules(report);
  if (risks.length > 0) {
    return risks;
  }
  return ['避免保证收益或保证结果', '避免虚假稀缺和站外交易引导'];
};

const buildReviewScript = (
  report: PrototypeAnalysisReport,
  keepList: string[],
  avoidList: string[],
): string => {
  const firstFinding: ScriptFinding | undefined = report.findings[0];
  const topReplacement: string =
    firstFinding?.replacementScript ||
    '课程会提供方法、练习和反馈，但实际效果和个人基础、投入时间、执行情况都有关系。';
  const missingStages: string[] = report.frameworkMatches
    .filter((match) => match.status === 'missing' || match.status === 'weak')
    .map((match) => match.stageName)
    .slice(0, 3);

  return [
    '这场直播可以继续保留：' + keepList.join('、') + '。',
    '下一场要优先避开：' +
      avoidList.join('、') +
      '。这些表达容易被理解成保证收益、保证结果，或者暗示案例可以复制。',
    missingStages.length > 0
      ? '节奏上需要补强：' +
        missingStages.join('、') +
        '。讲到课程时，把适合人群、交付内容、学习边界和报名路径说清楚。'
      : '主要直播环节已经覆盖，下一场重点把高风险表达换成更稳的说法。',
    '可以直接替换成：' + topReplacement,
  ].join('\n\n');
};

const buildFeishuDocumentTitle = (report: PrototypeAnalysisReport): string => {
  const dateText: string = new Date().toLocaleDateString('zh-CN');
  return dateText + ' ' + report.title + '复盘';
};

const getFeishuResultTitle = (result: FeishuSyncResult): string => {
  if (result.status === 'synced') {
    return '已同步到飞书';
  }
  if (result.status === 'not_configured') {
    return '飞书文档预览已生成';
  }
  return '飞书同步失败';
};

const getFeishuResultMessage = (result: FeishuSyncResult): string => {
  if (result.status === 'not_configured') {
    return '当前为演示预览。正式接入飞书后，会直接创建可转发的复盘文档。';
  }
  return result.message;
};

const copyText = async (text: string): Promise<boolean> => {
  const textarea: HTMLTextAreaElement = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied: boolean = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (copied) {
    return true;
  }

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  return false;
};

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve: () => void) => {
    window.setTimeout(resolve, milliseconds);
  });

const AnalysisProgress: React.FC<AnalysisProgressProps> = ({
  mode,
  progress,
  uploading,
}) => {
  const stages: string[] = [
    '准备直播文件',
    '按时间点识别原话',
    '检查风险与直播节奏',
    '生成整改话术',
  ];
  const activeStage: number =
    progress < 32 ? 0 : progress < 58 ? 1 : progress < 82 ? 2 : 3;
  const modeLabel: string = uploading
    ? '正在分片上传直播录屏'
    : mode === 'demo'
      ? '正在准备完整示例报告'
      : mode === 'captured'
        ? '正在复盘刚刚录制的直播'
        : '正在复盘你上传的录屏';

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{modeLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            录屏越长，识别和分析需要的时间越久，请保持页面开启。
          </p>
        </div>
        <span className="text-sm font-medium text-primary">{progress}%</span>
      </div>
      <Progress className="mt-4" value={progress} />
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stages.map((stage: string, index: number) => {
          const completed: boolean = index < activeStage;
          const active: boolean = index === activeStage;
          return (
            <div
              key={stage}
              className={
                'flex items-center gap-2 text-xs ' +
                (completed || active
                  ? 'text-foreground'
                  : 'text-muted-foreground')
              }
            >
              {completed ? (
                <CheckCircle2 className="size-4 text-success" />
              ) : (
                <CircleDot
                  className={
                    'size-4 ' + (active ? 'text-primary' : 'text-border')
                  }
                />
              )}
              <span>{stage}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const historicalReportId: string | null = searchParams.get('report');
  const [capability, setCapability] = useState<AnalysisCapability | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingHistoricalReport, setLoadingHistoricalReport] =
    useState<boolean>(Boolean(historicalReportId));
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [uploadingRecording, setUploadingRecording] = useState<boolean>(false);
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(null);
  const [progress, setProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [inputSource, setInputSource] = useState<InputSource>('live_url');
  const [liveUrl, setLiveUrl] = useState<string>('');
  const [recordingName, setRecordingName] = useState<string>('');
  const [selectedRecordingFile, setSelectedRecordingFile] =
    useState<File | null>(null);
  const [frameworkName, setFrameworkName] = useState<string>(
    DEFAULT_FRAMEWORK_NAME,
  );
  const [customFramework, setCustomFramework] = useState<string>('');
  const [showFrameworkSettings, setShowFrameworkSettings] =
    useState<boolean>(false);
  const [report, setReport] = useState<PrototypeAnalysisReport | null>(null);
  const [historicalDetail, setHistoricalDetail] =
    useState<HistoryReportDetail | null>(null);
  const [isDemoReport, setIsDemoReport] = useState<boolean>(false);
  const [reportView, setReportView] = useState<ReportView>('overview');
  const [copiedLabel, setCopiedLabel] = useState<string>('');
  const [chatQuestion, setChatQuestion] = useState<string>('');
  const [chatMessages, setChatMessages] = useState<ReportChatMessage[]>([]);
  const [chatRelatedSegments, setChatRelatedSegments] = useState<
    TranscriptSegmentSummary[]
  >([]);
  const [chatting, setChatting] = useState<boolean>(false);
  const [syncingFeishu, setSyncingFeishu] = useState<boolean>(false);
  const [feishuSyncResult, setFeishuSyncResult] =
    useState<FeishuSyncResult | null>(null);
  const [liveDataReplay, setLiveDataReplay] =
    useState<LiveDataReplayResult | null>(null);
  const [loadingLiveData, setLoadingLiveData] = useState<boolean>(false);
  const [liveDataError, setLiveDataError] = useState<string>('');
  const [startingRecording, setStartingRecording] = useState<boolean>(false);
  const [refreshingCapture, setRefreshingCapture] = useState<boolean>(false);
  const [analyzingPath, setAnalyzingPath] = useState<string>('');
  const [captureResult, setCaptureResult] =
    useState<RecorderCaptureResult | null>(null);

  useEffect(() => {
    const loadCapability = async (): Promise<void> => {
      try {
        const capabilityResult: AnalysisCapability =
          await analysis.getCapability();
        setCapability(capabilityResult);
      } catch {
        setErrorMessage('复盘服务暂时没有准备好，请刷新页面后再试。');
      } finally {
        setLoading(false);
      }
    };

    void loadCapability();
  }, []);

  useEffect(() => {
    if (!historicalReportId) {
      setLoadingHistoricalReport(false);
      setHistoricalDetail(null);
      return;
    }

    let disposed = false;
    setLoadingHistoricalReport(true);
    setErrorMessage('');
    setReport(null);

    const loadHistoricalReport = async (): Promise<void> => {
      try {
        const detail: HistoryReportDetail =
          await historyApi.getReport(historicalReportId);
        if (!disposed) {
          setHistoricalDetail(detail);
          setReport(detail.report);
          setIsDemoReport(false);
          setReportView('overview');
        }
      } catch {
        if (!disposed) {
          setHistoricalDetail(null);
          setErrorMessage('这份历史复盘暂时无法打开，请返回历史记录重试。');
        }
      } finally {
        if (!disposed) {
          setLoadingHistoricalReport(false);
        }
      }
    };

    void loadHistoricalReport();
    return () => {
      disposed = true;
    };
  }, [historicalReportId]);

  useEffect(() => {
    if (!submitting || uploadingRecording) {
      return undefined;
    }
    const timer: number = window.setInterval(() => {
      setProgress((current: number) => {
        if (current >= 92) {
          return current;
        }
        const increment: number = current < 40 ? 7 : current < 70 ? 4 : 2;
        return Math.min(92, current + increment);
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [submitting, uploadingRecording]);

  useEffect(() => {
    if (captureResult?.status !== 'recording') {
      return undefined;
    }

    const timer: number = window.setInterval(() => {
      void refreshCaptureStatus(captureResult.id, false);
    }, 8000);

    return () => window.clearInterval(timer);
  }, [captureResult?.id, captureResult?.status]);

  useEffect(() => {
    setChatMessages([]);
    setChatQuestion('');
    setChatRelatedSegments([]);
    setFeishuSyncResult(null);
    setLiveDataReplay(null);
    setLiveDataError('');
  }, [report?.id]);

  useEffect(() => {
    if (!report) {
      setLiveDataReplay(null);
      setLoadingLiveData(false);
      return undefined;
    }

    let disposed = false;

    const loadLiveDataReplay = async (): Promise<void> => {
      setLoadingLiveData(true);
      setLiveDataError('');

      try {
        const result: LiveDataReplayResult = isDemoReport
          ? buildDemoLiveDataReplay(report)
          : await analytics.createMockLiveDataReplay({
              report,
              provider: 'mock_third_party',
            });
        if (!disposed) {
          setLiveDataReplay(result);
        }
      } catch {
        const fallbackResult: LiveDataReplayResult =
          buildDemoLiveDataReplay(report);
        if (!disposed) {
          setLiveDataReplay(fallbackResult);
          setLiveDataError('');
        }
      } finally {
        if (!disposed) {
          setLoadingLiveData(false);
        }
      }
    };

    void loadLiveDataReplay();

    return () => {
      disposed = true;
    };
  }, [isDemoReport, report]);

  useEffect(() => {
    if (!report) {
      return undefined;
    }
    const timer: number = window.setTimeout(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [report]);

  const canCapture: boolean = useMemo(
    () =>
      !startingRecording &&
      !submitting &&
      captureResult?.status !== 'recording' &&
      liveUrl.trim().length > 0,
    [captureResult?.status, liveUrl, startingRecording, submitting],
  );
  const canAnalyzeRecording: boolean = useMemo(
    () => Boolean(selectedRecordingFile) && !submitting,
    [selectedRecordingFile, submitting],
  );
  const reportScore: number = useMemo(
    () => (report ? buildRiskScore(report) : 0),
    [report],
  );
  const topRiskRules: string[] = useMemo(
    () => (report ? getTopRiskRules(report) : []),
    [report],
  );
  const keepList: string[] = useMemo(
    () => (report ? buildKeepList(report) : []),
    [report],
  );
  const avoidList: string[] = useMemo(
    () => (report ? buildAvoidList(report) : []),
    [report],
  );
  const priorityFindings: ScriptFinding[] = useMemo(() => {
    if (!report) {
      return [];
    }
    return [...report.findings]
      .sort((a: ScriptFinding, b: ScriptFinding) => {
        const weight: Record<RiskLevel, number> = {
          critical: 4,
          high: 3,
          medium: 2,
          low: 1,
        };
        return weight[b.riskLevel] - weight[a.riskLevel];
      })
      .slice(0, 3);
  }, [report]);
  const rhythmGapCount: number = useMemo(
    () =>
      report
        ? report.frameworkMatches.filter(
            (match) => match.status === 'missing' || match.status === 'weak',
          ).length
        : 0,
    [report],
  );
  const reviewScript: string = useMemo(
    () => (report ? buildReviewScript(report, keepList, avoidList) : ''),
    [avoidList, keepList, report],
  );
  const feishuDocumentTitle: string = useMemo(
    () => (report ? buildFeishuDocumentTitle(report) : ''),
    [report],
  );
  const feishuPreviewSections: Array<{ label: string; value: string }> =
    useMemo(
      () =>
        report
          ? [
              {
                label: '关键结论',
                value: report.summary.highRiskFindings + ' 个高风险',
              },
              {
                label: '复盘话术',
                value: reviewScript ? '已生成' : '待生成',
              },
              {
                label: '整改清单',
                value: report.findings.length + ' 条建议',
              },
              {
                label: '时间轴',
                value: report.transcriptSegments.length + ' 个片段',
              },
            ]
          : [],
      [report, reviewScript],
    );

  const completeReport = (
    result: PrototypeAnalysisReport,
    demo: boolean,
  ): void => {
    setProgress(100);
    setReport(result);
    setHistoricalDetail(null);
    setIsDemoReport(demo);
    setReportView('overview');
  };

  const createReportFromFileInBackground = async (
    request: FileUrlAnalysisRequest,
  ): Promise<PrototypeAnalysisReport> => {
    const startedJob: FileAnalysisJob =
      await analysis.startFileAnalysisJob(request);
    setProgress((current: number): number => Math.max(current, 46));

    for (
      let attempt: number = 0;
      attempt < ANALYSIS_JOB_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const job: FileAnalysisJob = await analysis.getFileAnalysisJob(
        startedJob.id,
      );
      if (job.status === 'completed' && job.report) {
        return job.report;
      }
      if (job.status === 'failed') {
        throw new Error(job.errorMessage || '录屏分析失败');
      }
      setProgress((current: number): number =>
        Math.max(current, job.phase === 'analyzing' ? 76 : 52),
      );
      await wait(ANALYSIS_JOB_POLL_INTERVAL_MS);
    }

    throw new Error('录屏分析等待超时');
  };

  const handleOpenDemo = async (): Promise<void> => {
    setSubmitting(true);
    setAnalysisMode('demo');
    setProgress(18);
    setErrorMessage('');

    try {
      const result: PrototypeAnalysisReport = buildDemoReport({
        inputSource: 'recording_upload',
        recordingName: 'AI 知识付费直播示例',
        frameworkName: frameworkName.trim() || DEFAULT_FRAMEWORK_NAME,
        customFramework: customFramework.trim() || undefined,
      });
      completeReport(result, true);
    } catch {
      setErrorMessage('示例报告生成失败，请稍后再试。');
    } finally {
      setSubmitting(false);
      setAnalysisMode(null);
    }
  };

  const handleUploadRecordingAndAnalyze = async (): Promise<void> => {
    if (!selectedRecordingFile) {
      setErrorMessage('请先选择一段直播录屏。');
      return;
    }

    setSubmitting(true);
    setUploadingRecording(true);
    setAnalysisMode('upload');
    setProgress(8);
    setErrorMessage('');

    try {
      const uploadResult: BrowserRecordingUploadResult =
        await storage.uploadRecordingFile(
          selectedRecordingFile,
          (uploadPercentage: number) => {
            setProgress(8 + Math.round(uploadPercentage * 0.34));
          },
        );
      setUploadingRecording(false);
      setProgress(42);
      const result: PrototypeAnalysisReport =
        await createReportFromFileInBackground({
          inputSource: 'recording_upload',
          recordingName: uploadResult.originalName,
          frameworkName: frameworkName.trim() || DEFAULT_FRAMEWORK_NAME,
          customFramework: customFramework.trim() || undefined,
          fileUrl: uploadResult.fileUrl,
        });
      completeReport(result, false);
    } catch {
      setErrorMessage('录屏上传或识别失败，请检查文件格式和网络后再试。');
    } finally {
      setUploadingRecording(false);
      setSubmitting(false);
      setAnalysisMode(null);
    }
  };

  const handleAnalyzeCapturedFile = async (
    localPath: string,
  ): Promise<void> => {
    if (!captureResult) {
      setErrorMessage('没有找到这次直播的录屏。');
      return;
    }

    setSubmitting(true);
    setAnalysisMode('captured');
    setAnalyzingPath(localPath);
    setProgress(12);
    setErrorMessage('');

    try {
      const capturedFileName: string =
        captureResult.files.find((file) => file.path === localPath)?.name ||
        '直播录屏';
      const uploadedFile: OssUploadResult = await storage.uploadLocalFile({
        localPath,
      });
      setProgress(42);
      const result: PrototypeAnalysisReport =
        await createReportFromFileInBackground({
          inputSource: 'live_url',
          liveUrl: liveUrl.trim() || undefined,
          recordingName: capturedFileName,
          frameworkName: frameworkName.trim() || DEFAULT_FRAMEWORK_NAME,
          customFramework: customFramework.trim() || undefined,
          fileUrl: uploadedFile.fileUrl,
        });
      completeReport(result, false);
    } catch {
      setErrorMessage('这段录屏暂时没有分析成功，请确认录制已经结束后再试。');
    } finally {
      setSubmitting(false);
      setAnalysisMode(null);
      setAnalyzingPath('');
    }
  };

  const refreshCaptureStatus = async (
    captureId: string,
    showLoading: boolean = true,
  ): Promise<void> => {
    if (showLoading) {
      setRefreshingCapture(true);
    }
    try {
      const result: RecorderCaptureResult =
        await recorder.getCaptureStatus(captureId);
      setCaptureResult(result);
    } catch {
      if (showLoading) {
        setErrorMessage('录制状态刷新失败，请稍后再试。');
      }
    } finally {
      if (showLoading) {
        setRefreshingCapture(false);
      }
    }
  };

  const handleStartRecording = async (): Promise<void> => {
    if (!liveUrl.trim()) {
      setErrorMessage('请先粘贴直播间链接。');
      return;
    }

    setStartingRecording(true);
    setErrorMessage('');
    setCaptureResult(null);

    try {
      const result: RecorderCaptureResult = await recorder.captureLive({
        liveUrl: liveUrl.trim(),
      });
      setCaptureResult(result);
    } catch {
      setErrorMessage(
        '直播录制启动失败，请确认主播已经开播、链接可以正常打开。',
      );
    } finally {
      setStartingRecording(false);
    }
  };

  const handleAskReport = async (presetQuestion?: string): Promise<void> => {
    if (!report) {
      setErrorMessage('请先生成本场直播的复盘报告。');
      return;
    }

    const question: string = (presetQuestion || chatQuestion).trim();
    if (!question) {
      setErrorMessage('请先输入你想追问的问题。');
      return;
    }

    const nextMessages: ReportChatMessage[] = [
      ...chatMessages,
      {
        role: 'user',
        content: question,
      },
    ];

    setChatMessages(nextMessages);
    setChatQuestion('');
    setChatting(true);
    setErrorMessage('');

    try {
      const response: ReportChatResponse = await analysis.chatWithReport({
        report,
        question,
        messages: chatMessages.slice(-6),
      });
      setChatRelatedSegments(response.relatedSegments);
      setChatMessages((current: ReportChatMessage[]) => [
        ...current,
        {
          role: 'assistant',
          content: response.answer,
        },
      ]);
    } catch {
      setErrorMessage('这个问题暂时没有回答成功，请换个问法再试。');
    } finally {
      setChatting(false);
    }
  };

  const handleSyncFeishu = async (): Promise<void> => {
    if (!report) {
      setErrorMessage('请先生成本场直播的复盘报告。');
      return;
    }

    setSyncingFeishu(true);
    setErrorMessage('');

    try {
      const result: FeishuSyncResult = await feishu.syncReport({
        report,
        reviewScript,
      });
      setFeishuSyncResult(result);
    } catch {
      setErrorMessage('飞书文档暂时没有生成成功，请稍后再试。');
    } finally {
      setSyncingFeishu(false);
    }
  };

  const handleCopy = async (text: string, label: string): Promise<void> => {
    try {
      const copied: boolean = await copyText(text);
      if (!copied) {
        setErrorMessage('当前浏览器不支持一键复制，请手动选择文字。');
        return;
      }
      setCopiedLabel(label);
      window.setTimeout(() => setCopiedLabel(''), 1800);
    } catch {
      setErrorMessage('复制失败，请手动选择文字。');
    }
  };

  const handleStartNewReview = (): void => {
    setReport(null);
    setIsDemoReport(false);
    setReportView('overview');
    setErrorMessage('');
    setLiveUrl('');
    setRecordingName('');
    setSelectedRecordingFile(null);
    setCaptureResult(null);
    setHistoricalDetail(null);
    navigate('/', { replace: true });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loading || loadingHistoricalReport) {
    return (
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-[34rem] w-full" />
      </main>
    );
  }

  if (historicalReportId && !report) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>历史复盘没有打开</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
        <Button
          type="button"
          className="mt-5"
          variant="outline"
          onClick={() => navigate('/history')}
        >
          <FileText className="size-4" />
          返回历史记录
        </Button>
      </main>
    );
  }

  if (!report) {
    return (
      <main className="mx-auto w-full max-w-7xl space-y-7 px-4 py-8 sm:px-6 lg:px-8">
        <section className="border-b border-border pb-7">
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">AI 知识付费直播</Badge>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={
                      'size-2 rounded-full ' +
                      (capability?.configured ? 'bg-success' : 'bg-warning')
                    }
                  />
                  {capability?.configured ? '可以开始复盘' : '服务状态待确认'}
                </span>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-normal sm:text-4xl">
                AI 知识付费直播复盘
              </h1>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => {
                void handleOpenDemo();
              }}
            >
              <PlayCircle className="size-4" />
              先看完整示例
            </Button>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {outcomeItems.map((item: OutcomeItem) => (
              <div
                key={item.label}
                className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="text-primary">{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        {errorMessage ? (
          <Alert variant="destructive">
            <ShieldAlert className="size-4" />
            <AlertTitle>这一步没有完成</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="overflow-hidden rounded-lg">
          <CardHeader className="border-b border-border bg-muted/20">
            <div className="flex items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Video className="size-4" />
              </div>
              <div>
                <CardTitle className="text-xl tracking-normal">
                  提交一场直播
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6 p-5 sm:p-6">
            <Tabs
              value={inputSource}
              onValueChange={(value: string) => {
                setInputSource(value as InputSource);
                setErrorMessage('');
              }}
            >
              <TabsList className="grid h-auto w-full grid-cols-2 rounded-lg p-1 sm:w-[26rem]">
                <TabsTrigger className="min-h-10" value="live_url">
                  <Link2 className="size-4" />
                  直播正在进行
                </TabsTrigger>
                <TabsTrigger className="min-h-10" value="recording_upload">
                  <Upload className="size-4" />
                  我已有录屏
                </TabsTrigger>
              </TabsList>

              <TabsContent value="live_url" className="mt-5 space-y-4">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium"
                    htmlFor="live-room-url"
                  >
                    直播间链接
                  </label>
                  <div className="flex flex-col gap-3 md:flex-row">
                    <Input
                      id="live-room-url"
                      value={liveUrl}
                      disabled={Boolean(captureResult) || startingRecording}
                      onChange={(
                        event: React.ChangeEvent<HTMLInputElement>,
                      ) => {
                        setLiveUrl(event.target.value);
                        setErrorMessage('');
                      }}
                      placeholder="粘贴抖音直播间链接"
                    />
                    {captureResult?.status !== 'recording' &&
                    captureResult?.status !== 'completed' ? (
                      <Button
                        type="button"
                        className="md:min-w-36"
                        disabled={!canCapture}
                        onClick={() => {
                          void handleStartRecording();
                        }}
                      >
                        <CircleDot className="size-4" />
                        {startingRecording ? '正在启动' : '开始录制'}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {captureResult ? (
                  <div className="rounded-lg border border-border p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={captureStatusVariant(captureResult.status)}
                        >
                          {captureStatusLabel(captureResult.status)}
                        </Badge>
                        {captureResult.status === 'recording' ? (
                          <span className="text-xs text-muted-foreground">
                            已开始于{' '}
                            {new Date(
                              captureResult.startedAt,
                            ).toLocaleTimeString('zh-CN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={refreshingCapture || submitting}
                        onClick={() => {
                          void refreshCaptureStatus(captureResult.id);
                        }}
                      >
                        <RefreshCw className="size-3" />
                        {refreshingCapture ? '刷新中' : '刷新状态'}
                      </Button>
                    </div>

                    {captureResult.status === 'recording' ? (
                      <div className="mt-4">
                        <p className="text-sm leading-6">
                          正在持续保存这场直播。主播下播后，状态会自动变成“录制完成”。
                        </p>
                        <div className="mt-4 flex items-center gap-3">
                          <span className="relative flex size-3">
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive/60" />
                            <span className="relative inline-flex size-3 rounded-full bg-destructive" />
                          </span>
                          <span className="text-xs text-muted-foreground">
                            后台录制中，每 8 秒自动检查一次
                          </span>
                        </div>
                      </div>
                    ) : null}

                    {captureResult.status === 'completed' ? (
                      <div className="mt-4 space-y-3">
                        <div>
                          <p className="text-sm font-medium">
                            录屏已经保存，可以开始复盘
                          </p>
                        </div>
                        {captureResult.files.length > 0 ? (
                          captureResult.files.map((file) => (
                            <div
                              key={file.path}
                              className="flex flex-col justify-between gap-3 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-center"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {file.name}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {formatFileSize(file.sizeBytes)}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                disabled={submitting}
                                onClick={() => {
                                  void handleAnalyzeCapturedFile(file.path);
                                }}
                              >
                                <WandSparkles className="size-3" />
                                {analyzingPath === file.path
                                  ? '正在复盘'
                                  : '开始复盘'}
                              </Button>
                            </div>
                          ))
                        ) : (
                          <Alert>
                            <AlertTriangle className="size-4" />
                            <AlertTitle>还没有找到录屏文件</AlertTitle>
                            <AlertDescription>
                              稍等片刻后刷新状态；如果仍然没有文件，可以重新录制。
                            </AlertDescription>
                          </Alert>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={submitting}
                          onClick={() => {
                            setCaptureResult(null);
                          }}
                        >
                          <RotateCcw className="size-3" />
                          重新录制
                        </Button>
                      </div>
                    ) : null}

                    {captureResult.status === 'failed' ? (
                      <div className="mt-4">
                        <p className="text-sm leading-6">
                          这次没有拿到可用录屏。请确认主播正在直播，链接可以正常打开。
                        </p>
                        <Button
                          type="button"
                          className="mt-3"
                          size="sm"
                          variant="outline"
                          onClick={() => setCaptureResult(null)}
                        >
                          <RotateCcw className="size-3" />
                          重新尝试
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </TabsContent>

              <TabsContent value="recording_upload" className="mt-5 space-y-4">
                <input
                  id="recording-file"
                  className="sr-only"
                  type="file"
                  accept="video/*,audio/*"
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                    const file: File | undefined = event.target.files?.[0];
                    if (file && file.size > MAX_RECORDING_FILE_SIZE_BYTES) {
                      setSelectedRecordingFile(null);
                      setRecordingName('');
                      setErrorMessage('单个录屏文件不能超过 2 GB。');
                      event.target.value = '';
                      return;
                    }
                    setSelectedRecordingFile(file || null);
                    setRecordingName(file?.name || '');
                    setErrorMessage('');
                  }}
                />
                <label
                  htmlFor="recording-file"
                  className="flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center transition-colors hover:bg-muted/40"
                >
                  {selectedRecordingFile ? (
                    <>
                      <FileCheck2 className="size-7 text-success" />
                      <p className="mt-3 max-w-full truncate text-sm font-medium">
                        {selectedRecordingFile.name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatFileSize(selectedRecordingFile.size)} ·
                        点击可重新选择
                      </p>
                    </>
                  ) : (
                    <>
                      <Upload className="size-7 text-primary" />
                      <p className="mt-3 text-sm font-medium">
                        点击选择直播录屏
                      </p>
                    </>
                  )}
                </label>
                <Button
                  type="button"
                  disabled={!canAnalyzeRecording}
                  onClick={() => {
                    void handleUploadRecordingAndAnalyze();
                  }}
                >
                  <WandSparkles className="size-4" />
                  上传并开始复盘
                </Button>
              </TabsContent>
            </Tabs>

            <div className="border-t border-border pt-5">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">本次分析标准</p>
                    <Badge variant="outline">
                      {customFramework.trim() ? '已加入你的框架' : '内置框架'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {frameworkName || DEFAULT_FRAMEWORK_NAME}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={submitting}
                  onClick={() =>
                    setShowFrameworkSettings((current: boolean) => !current)
                  }
                >
                  <Settings2 className="size-3" />
                  {showFrameworkSettings ? '收起设置' : '更换标准'}
                </Button>
              </div>

              {showFrameworkSettings ? (
                <div className="mt-4 grid gap-4 rounded-lg bg-muted/30 p-4">
                  <div className="space-y-2">
                    <label
                      className="text-sm font-medium"
                      htmlFor="framework-name"
                    >
                      框架名称
                    </label>
                    <Input
                      id="framework-name"
                      value={frameworkName}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setFrameworkName(event.target.value)
                      }
                      placeholder={DEFAULT_FRAMEWORK_NAME}
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      className="text-sm font-medium"
                      htmlFor="custom-framework"
                    >
                      粘贴你自己的话术框架
                      <span className="ml-2 font-normal text-muted-foreground">
                        可选
                      </span>
                    </label>
                    <Textarea
                      id="custom-framework"
                      className="min-h-32"
                      value={customFramework}
                      onChange={(
                        event: React.ChangeEvent<HTMLTextAreaElement>,
                      ) => setCustomFramework(event.target.value)}
                      placeholder="例如：前 60 分钟输出干货并完成案例演示；60-84 分钟承接课程和权益；84-90 分钟讲案例；后续持续成交承接。"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {submitting ? (
              <AnalysisProgress
                mode={analysisMode}
                progress={progress}
                uploading={uploadingRecording}
              />
            ) : null}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-7 sm:px-6 lg:px-8">
      <section className="border-b border-border pb-6">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">复盘完成</Badge>
              {isDemoReport ? (
                <Badge variant="secondary">示例报告</Badge>
              ) : null}
              {historicalDetail ? (
                <Badge variant="secondary">历史记录</Badge>
              ) : null}
              <span className="text-xs text-muted-foreground">
                分析标准：{report.frameworkName}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-normal sm:text-3xl">
              {report.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatTime(report.durationSeconds)} ·{' '}
              {report.transcriptWordCount} 字 ·{' '}
              {report.transcriptSegments.length} 个时间轴片段
              {historicalDetail ? (
                <>
                  {' '}
                  · {historicalDetail.owner.displayName} ·{' '}
                  {new Date(historicalDetail.createdAt).toLocaleString(
                    'zh-CN',
                    {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    },
                  )}
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('/history')}
            >
              <FileText className="size-4" />
              历史记录
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleStartNewReview}
            >
              <RotateCcw className="size-4" />
              新建复盘
            </Button>
            <Button type="button" onClick={() => setReportView('rewrite')}>
              <WandSparkles className="size-4" />
              看可播改稿
            </Button>
          </div>
        </div>

        <div className="mt-6 grid overflow-hidden rounded-lg border border-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="border-b border-border p-4 sm:border-r lg:border-b-0">
            <p className="text-xs text-muted-foreground">话术安全分</p>
            <div className="mt-1 flex items-end gap-2">
              <span className="text-3xl font-semibold">{reportScore}</span>
              <span className="pb-1 text-xs text-muted-foreground">
                {scoreLabel(reportScore)}
              </span>
            </div>
          </div>
          <div className="border-b border-border p-4 lg:border-b-0 lg:border-r">
            <p className="text-xs text-muted-foreground">高风险原话</p>
            <p className="mt-1 text-2xl font-semibold">
              {report.summary.highRiskFindings}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                处
              </span>
            </p>
          </div>
          <div className="border-b border-border p-4 sm:border-b-0 sm:border-r">
            <p className="text-xs text-muted-foreground">节奏缺口</p>
            <p className="mt-1 text-2xl font-semibold">
              {rhythmGapCount}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                处
              </span>
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-muted-foreground">可替换改法</p>
            <p className="mt-1 text-2xl font-semibold">
              {report.summary.rewriteSuggestions}
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                条
              </span>
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-muted/50 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">这场直播的关键结论</p>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                {report.summary.overallDiagnosis}
              </p>
              {topRiskRules.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {topRiskRules.map((rule: string) => (
                    <Badge key={rule} variant="destructive">
                      优先改：{rule}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {errorMessage ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>操作没有完成</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {copiedLabel ? (
        <Alert>
          <CheckCircle2 className="size-4 text-success" />
          <AlertTitle>已复制</AlertTitle>
          <AlertDescription>{copiedLabel}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={reportView}
        onValueChange={(value: string) => setReportView(value as ReportView)}
        className="gap-5"
      >
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg p-1 md:grid-cols-3 xl:grid-cols-6">
          <TabsTrigger className="min-h-10" value="overview">
            <LayoutDashboard className="size-4" />
            总览
          </TabsTrigger>
          <TabsTrigger className="min-h-10" value="risks">
            <ShieldAlert className="size-4" />
            风险整改
          </TabsTrigger>
          <TabsTrigger className="min-h-10" value="rhythm">
            <Clock3 className="size-4" />
            节奏时间轴
          </TabsTrigger>
          <TabsTrigger className="min-h-10" value="data">
            <BarChart3 className="size-4" />
            数据复盘
          </TabsTrigger>
          <TabsTrigger className="min-h-10" value="rewrite">
            <WandSparkles className="size-4" />
            复盘改稿
          </TabsTrigger>
          <TabsTrigger className="min-h-10" value="chat">
            <MessageSquareText className="size-4" />
            追问报告
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-7">
          <section>
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-medium text-primary">先处理</p>
                <h2 className="mt-1 text-xl font-semibold tracking-normal">
                  这场直播最该先改的三处
                </h2>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReportView('risks')}
              >
                查看全部整改
                <ChevronRight className="size-3" />
              </Button>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              {priorityFindings.length > 0 ? (
                priorityFindings.map(
                  (finding: ScriptFinding, index: number) => (
                    <div
                      key={finding.id}
                      className="rounded-lg border border-border p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-xs font-medium text-background">
                            {index + 1}
                          </span>
                          <Badge variant={riskVariant(finding.riskLevel)}>
                            {riskLabel(finding.riskLevel)}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {formatTime(finding.startSeconds)}
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm font-medium leading-6">
                        {finding.originalText}
                      </p>
                      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                        {finding.analysis}
                      </p>
                      <Button
                        type="button"
                        className="mt-3 px-0"
                        size="sm"
                        variant="ghost"
                        onClick={() => setReportView('risks')}
                      >
                        看推荐说法
                        <ChevronRight className="size-3" />
                      </Button>
                    </div>
                  ),
                )
              ) : (
                <div className="rounded-lg border border-border p-4 lg:col-span-3">
                  <p className="text-sm font-medium">暂未发现明显高风险</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    可以继续检查直播节奏和课程承接是否完整。
                  </p>
                </div>
              )}
            </div>
          </section>

          <section>
            <div>
              <p className="text-xs font-medium text-primary">下一场</p>
              <h2 className="mt-1 text-xl font-semibold tracking-normal">
                主播行动清单
              </h2>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-border border-l-success border-l-4 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-success" />
                  <p className="text-sm font-medium">继续保留</p>
                </div>
                <div className="mt-3 space-y-2">
                  {keepList.map((item: string) => (
                    <p
                      key={item}
                      className="text-sm leading-6 text-muted-foreground"
                    >
                      {item}
                    </p>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-border border-l-destructive border-l-4 p-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="size-4 text-destructive" />
                  <p className="text-sm font-medium">优先别再说</p>
                </div>
                <div className="mt-3 space-y-2">
                  {avoidList.map((item: string) => (
                    <p
                      key={item}
                      className="text-sm leading-6 text-muted-foreground"
                    >
                      {item}
                    </p>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-border border-l-warning border-l-4 p-4">
                <div className="flex items-center gap-2">
                  <ListChecks className="size-4 text-warning" />
                  <p className="text-sm font-medium">下一步先做</p>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  先替换高风险原话，再补充课程交付、适合人群、案例边界和平台内报名路径。
                </p>
                <Button
                  type="button"
                  className="mt-3 px-0"
                  size="sm"
                  variant="ghost"
                  onClick={() => setReportView('rewrite')}
                >
                  打开复盘改稿
                  <ChevronRight className="size-3" />
                </Button>
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="risks" className="space-y-5">
          <section>
            <p className="text-xs font-medium text-primary">逐句整改</p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">
              风险原话与可替换说法
            </h2>
          </section>

          {report.findings.length > 0 ? (
            <div className="space-y-4">
              {report.findings.map((finding: ScriptFinding) => (
                <article
                  key={finding.id}
                  className="rounded-lg border border-border p-4 sm:p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={riskVariant(finding.riskLevel)}>
                      {riskLabel(finding.riskLevel)}
                    </Badge>
                    <Badge variant="outline">{findingTypeLabel(finding)}</Badge>
                    <Badge variant="outline">
                      {formatTime(finding.startSeconds)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {finding.matchedRule.replace(/^DeepSeek 语义判断：/, '')}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground">
                        主播原话
                      </p>
                      <p className="mt-2 rounded-md bg-destructive/5 p-3 text-sm leading-7">
                        {finding.originalText}
                      </p>
                      <p className="mt-4 text-xs font-medium text-muted-foreground">
                        为什么要改
                      </p>
                      <p className="mt-2 text-sm leading-7">
                        {finding.analysis}
                      </p>
                    </div>
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-medium text-muted-foreground">
                          推荐说法
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void handleCopy(
                              finding.replacementScript,
                              '推荐说法已复制',
                            );
                          }}
                        >
                          <Copy className="size-3" />
                          复制
                        </Button>
                      </div>
                      <p className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-sm leading-7">
                        {finding.replacementScript}
                      </p>
                      <p className="mt-4 text-xs font-medium text-muted-foreground">
                        整改方向
                      </p>
                      <p className="mt-2 text-sm leading-7">
                        {finding.suggestion}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Alert>
              <CheckCircle2 className="size-4 text-success" />
              <AlertTitle>暂未发现明显风险</AlertTitle>
              <AlertDescription>
                可以继续补充更长录屏，重点检查课程承接和成交阶段。
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="rhythm" className="space-y-8">
          <section>
            <p className="text-xs font-medium text-primary">框架对照</p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">
              直播节奏检查
            </h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {report.frameworkMatches.map((match: FrameworkMatchSummary) => (
                <div
                  key={match.stageName}
                  className="rounded-lg border border-border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{match.stageName}</p>
                    <Badge variant={frameworkStatusVariant(match.status)}>
                      {frameworkStatusLabel(match.status)}
                    </Badge>
                  </div>
                  {match.expectedWindow ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      建议时段：{match.expectedWindow}
                    </p>
                  ) : null}
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {match.evidence}
                  </p>
                  <p className="mt-3 text-sm leading-6">{match.suggestion}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <p className="text-xs font-medium text-primary">带时间点原话</p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">
              逐字稿时间轴
            </h2>
            <div className="mt-5 space-y-0">
              {report.transcriptSegments.map(
                (segment: TranscriptSegmentSummary, index: number) => {
                  const segmentFindings: ScriptFinding[] =
                    report.findings.filter(
                      (finding: ScriptFinding) =>
                        finding.startSeconds >= segment.startSeconds &&
                        (finding.startSeconds < segment.endSeconds ||
                          (index === report.transcriptSegments.length - 1 &&
                            finding.startSeconds === segment.endSeconds)),
                    );
                  return (
                    <div
                      key={segment.id}
                      className="grid grid-cols-[64px_1fr] gap-3 sm:grid-cols-[88px_1fr] sm:gap-4"
                    >
                      <div className="relative flex flex-col items-end">
                        <Badge variant="outline">
                          {formatTime(segment.startSeconds)}
                        </Badge>
                        {index < report.transcriptSegments.length - 1 ? (
                          <div className="mt-2 h-full w-px flex-1 bg-border" />
                        ) : null}
                      </div>
                      <div className="pb-5">
                        <div className="rounded-lg border border-border p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">
                              {segment.matchedStage}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatTime(segment.startSeconds)}-
                              {formatTime(segment.endSeconds)} ·{' '}
                              {segment.wordCount} 字
                            </span>
                          </div>
                          <p className="mt-3 text-sm leading-7">
                            {segment.text}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {segmentFindings.length > 0 ? (
                              segmentFindings.map((finding: ScriptFinding) => (
                                <Badge
                                  key={finding.id}
                                  variant={riskVariant(finding.riskLevel)}
                                >
                                  {riskLabel(finding.riskLevel)} ·{' '}
                                  {findingTypeLabel(finding)}
                                </Badge>
                              ))
                            ) : (
                              <Badge variant="outline">暂无明显风险</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="data" className="space-y-5">
          <section className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-medium text-primary">话术和数据对照</p>
              <h2 className="mt-1 text-xl font-semibold tracking-normal">
                直播数据复盘
              </h2>
            </div>
            <Badge variant="secondary">
              {liveDataReplay?.sourceLabel || '示例第三方数据'}
            </Badge>
          </section>

          {loadingLiveData ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {[0, 1, 2, 3, 4].map((item: number) => (
                  <Skeleton key={item} className="h-20 w-full" />
                ))}
              </div>
              <Skeleton className="h-72 w-full" />
            </div>
          ) : liveDataError ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>数据复盘暂时不可用</AlertTitle>
              <AlertDescription>{liveDataError}</AlertDescription>
            </Alert>
          ) : liveDataReplay ? (
            <>
              <Alert>
                <Activity className="size-4 text-primary" />
                <AlertTitle>当前使用示例数据</AlertTitle>
                <AlertDescription>
                  用于演示“某段话术出现时，在线和互动是否同步变化”的完整效果。
                </AlertDescription>
              </Alert>

              <div className="grid overflow-hidden rounded-lg border border-border sm:grid-cols-2 lg:grid-cols-5">
                {[
                  {
                    label: '最高在线',
                    value: liveDataReplay.summary.peakOnlineUsers,
                  },
                  {
                    label: '平均在线',
                    value: liveDataReplay.summary.averageOnlineUsers,
                  },
                  {
                    label: '互动量',
                    value: liveDataReplay.summary.totalInteractions,
                  },
                  {
                    label: '点击线索',
                    value: liveDataReplay.summary.totalProductClicks,
                  },
                  {
                    label: '转化率',
                    value: liveDataReplay.summary.conversionRate + '%',
                  },
                ].map((metric, index: number) => (
                  <div
                    key={metric.label}
                    className={
                      'p-4 ' +
                      (index < 4
                        ? 'border-b border-border lg:border-b-0 '
                        : '') +
                      (index % 2 === 0 ? 'sm:border-r sm:border-border ' : '') +
                      (index < 4 ? 'lg:border-r lg:border-border' : '')
                    }
                  >
                    <p className="text-xs text-muted-foreground">
                      {metric.label}
                    </p>
                    <p className="mt-1 text-2xl font-semibold">
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-border p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">数据曲线与话术时间点</p>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {liveDataReplay.points.length} 个采样点
                  </span>
                </div>
                <ChartContainer
                  config={liveDataChartConfig}
                  className="aspect-auto h-72 w-full"
                >
                  <LineChart
                    data={liveDataReplay.points}
                    margin={{
                      top: 16,
                      right: 18,
                      bottom: 8,
                      left: 8,
                    }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="timeLabel"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      width={42}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={<ChartTooltipContent indicator="line" />}
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line
                      dataKey="onlineUsers"
                      type="monotone"
                      stroke="var(--color-onlineUsers)"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      dataKey="interactions"
                      type="monotone"
                      stroke="var(--color-interactions)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ChartContainer>
              </div>

              <div className="rounded-lg bg-muted/40 p-4">
                <p className="text-sm font-medium">数据结论</p>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {liveDataReplay.summary.overallDiagnosis}
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-3">
                {liveDataReplay.insights.map((insight: LiveDataInsight) => (
                  <div
                    key={insight.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={riskVariant(insight.severity)}>
                        {riskLabel(insight.severity)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(insight.startSeconds)}-
                        {formatTime(insight.endSeconds)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium">{insight.title}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {insight.metricChange}
                    </p>
                    <p className="mt-3 line-clamp-3 text-sm leading-6">
                      {insight.relatedText}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {insight.diagnosis}
                    </p>
                    <p className="mt-3 rounded-md bg-muted/40 p-3 text-sm leading-6">
                      {insight.suggestion}
                    </p>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="rewrite" className="space-y-6">
          <section>
            <p className="text-xs font-medium text-primary">拿去就能用</p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">
              复盘话术与飞书沉淀
            </h2>
          </section>

          <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-lg border border-primary/20 bg-primary/5 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <WandSparkles className="size-5 text-primary" />
                  <p className="text-sm font-medium">可直接复制的复盘改稿</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void handleCopy(reviewScript, '整段复盘改稿已复制');
                  }}
                >
                  <Copy className="size-3" />
                  复制整段
                </Button>
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-8">
                {reviewScript}
              </p>
            </section>

            <section className="rounded-lg border border-border p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-md bg-primary/10 p-2 text-primary">
                    <FileText className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">飞书复盘文档</p>
                  </div>
                </div>
                <Badge
                  variant={
                    feishuSyncResult?.status === 'synced'
                      ? 'default'
                      : 'secondary'
                  }
                >
                  {feishuSyncResult?.status === 'synced'
                    ? '已同步'
                    : '演示预览'}
                </Badge>
              </div>

              <div className="mt-4 rounded-md bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">文档标题</p>
                <p className="mt-1 text-sm font-medium">
                  {feishuDocumentTitle}
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {feishuPreviewSections.map((section) => (
                  <div
                    key={section.label}
                    className="rounded-md border border-border px-3 py-2"
                  >
                    <p className="text-xs text-muted-foreground">
                      {section.label}
                    </p>
                    <p className="mt-1 text-sm font-medium">{section.value}</p>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                className="mt-4 w-full"
                disabled={syncingFeishu}
                onClick={() => {
                  void handleSyncFeishu();
                }}
              >
                <Upload className="size-4" />
                {syncingFeishu ? '正在生成文档' : '同步到飞书'}
              </Button>
            </section>
          </div>

          {feishuSyncResult ? (
            <Alert>
              <FileText className="size-4 text-primary" />
              <AlertTitle>{getFeishuResultTitle(feishuSyncResult)}</AlertTitle>
              <AlertDescription>
                <p>{getFeishuResultMessage(feishuSyncResult)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {feishuSyncResult.documentUrl ? (
                    <Button type="button" size="sm" asChild>
                      <a
                        href={feishuSyncResult.documentUrl}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Link2 className="size-3" />
                        打开飞书文档
                      </a>
                    </Button>
                  ) : null}
                  {feishuSyncResult.status !== 'synced' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void handleCopy(
                          feishuSyncResult.contentMarkdown,
                          '飞书文档内容已复制',
                        );
                      }}
                    >
                      <Copy className="size-3" />
                      复制文档内容
                    </Button>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          ) : null}
        </TabsContent>

        <TabsContent value="chat" className="space-y-5">
          <section>
            <p className="text-xs font-medium text-primary">继续深挖</p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal">
              追问这场直播
            </h2>
          </section>

          <div className="flex flex-wrap gap-2">
            {[
              '这场直播最该先改哪三处？',
              '我的课程承接哪里最弱？',
              '把高风险原话改成能直接说的版本',
            ].map((question: string) => (
              <Button
                key={question}
                type="button"
                size="sm"
                variant="outline"
                disabled={chatting}
                onClick={() => {
                  void handleAskReport(question);
                }}
              >
                {question}
              </Button>
            ))}
          </div>

          <div className="min-h-64 space-y-3 rounded-lg border border-border bg-muted/20 p-4 sm:p-5">
            {chatMessages.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center text-center">
                <MessageSquareText className="size-7 text-primary" />
                <p className="mt-3 text-sm font-medium">
                  直接问这场直播的具体问题
                </p>
              </div>
            ) : (
              chatMessages.map((message: ReportChatMessage, index: number) => (
                <div
                  key={message.role + '-' + index}
                  className={
                    message.role === 'user'
                      ? 'ml-auto max-w-[88%] whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm leading-6 text-primary-foreground'
                      : 'max-w-[88%] whitespace-pre-wrap rounded-lg border border-border bg-background px-3 py-2 text-sm leading-6'
                  }
                >
                  {message.content}
                </div>
              ))
            )}
            {chatting ? (
              <div className="max-w-[88%] rounded-lg border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                正在结合本场原话和时间点回答...
              </div>
            ) : null}
          </div>

          {chatRelatedSegments.length > 0 ? (
            <section className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">本次回答参考的时间点</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {chatRelatedSegments.map(
                  (segment: TranscriptSegmentSummary) => (
                    <div
                      key={segment.id}
                      className="rounded-md bg-muted/40 p-3 text-xs leading-5"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {formatTime(segment.startSeconds)}
                        </Badge>
                        <span className="text-muted-foreground">
                          {segment.matchedStage}
                        </span>
                      </div>
                      <p className="line-clamp-3">{segment.text}</p>
                    </div>
                  ),
                )}
              </div>
            </section>
          ) : null}

          <div className="flex flex-col gap-2 md:flex-row">
            <Input
              value={chatQuestion}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setChatQuestion(event.target.value)
              }
              onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleAskReport();
                }
              }}
              placeholder="比如：第一个高风险点怎么讲得更稳？"
            />
            <Button
              type="button"
              className="md:min-w-24"
              disabled={chatting || chatQuestion.trim().length === 0}
              onClick={() => {
                void handleAskReport();
              }}
            >
              <Send className="size-4" />
              发送
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
};

export default DashboardPage;
