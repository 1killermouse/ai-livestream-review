export type UserRole = 'admin' | 'anchor';

export type SessionStatus = 'draft' | 'processing' | 'completed' | 'failed';

export type InputSource = 'live_url' | 'recording_upload';

export type FindingType = 'banned_word' | 'semantic_risk' | 'framework_gap';

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';

export type ReviewDomain = 'live_script_rewrite';

export interface AccessProfile {
  userId: string;
  userName: string;
  role: UserRole;
}

export interface InternalUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface AuthStatusResponse {
  initialized: boolean;
  authenticated: boolean;
  user?: InternalUser;
}

export interface AuthSessionResponse {
  user: InternalUser;
  token: string;
}

export interface BootstrapAccountRequest {
  username: string;
  displayName: string;
  password: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface CreateInternalAccountRequest extends BootstrapAccountRequest {
  role?: UserRole;
}

export interface InternalAccountSummary extends InternalUser {
  active: boolean;
  createdAt: string;
}

export interface WorkspaceStats {
  sessions: number;
  pendingFindings: number;
  highRiskFindings: number;
  rewriteSuggestions: number;
}

export interface LiveSessionSummary {
  id: string;
  ownerId: string;
  title: string;
  liveStartedAt?: string;
  durationSeconds: number;
  status: SessionStatus;
  inputSource: InputSource;
  findingCount: number;
  highRiskCount: number;
  createdAt: string;
}

export interface ReviewFindingSummary {
  id: string;
  sessionId: string;
  findingType: FindingType;
  riskLevel: RiskLevel;
  occurredAtSeconds: number;
  originalText?: string;
  ruleTitle?: string;
  ruleExcerpt?: string;
  analysis: string;
  suggestion?: string;
  confidence: number;
  status: 'pending' | 'confirmed' | 'dismissed';
}

export interface WorkspaceOverviewResponse {
  access: AccessProfile;
  stats: WorkspaceStats;
  sessions: LiveSessionSummary[];
  findings: ReviewFindingSummary[];
}

export interface CreateSessionRequest {
  title: string;
  liveStartedAt?: string;
  inputSource?: InputSource;
}

export interface UpdateRoleRequest {
  role: UserRole;
}

export interface AnalysisCapability {
  langchain: true;
  langgraph: true;
  configured: boolean;
  deepseekConfigured?: boolean;
  deepseekModel?: string;
  embeddingConfigured?: boolean;
  embeddingModel?: string;
  embeddingDimensions?: number;
  domain: ReviewDomain;
  domainVersion: string;
  workflow: string[];
  riskTaxonomy: string[];
}

export interface PrototypeAnalysisRequest {
  inputSource: InputSource;
  liveUrl?: string;
  recordingName?: string;
  durationMinutes?: number;
  frameworkName?: string;
  customFramework?: string;
}

export interface TranscribeUrlRequest {
  fileUrl: string;
}

export interface FileUrlAnalysisRequest extends PrototypeAnalysisRequest {
  fileUrl: string;
}

export type FileAnalysisJobStatus = 'processing' | 'completed' | 'failed';

export type FileAnalysisJobPhase =
  | 'transcribing'
  | 'analyzing'
  | 'completed'
  | 'failed';

export interface FileAnalysisJob {
  id: string;
  status: FileAnalysisJobStatus;
  phase: FileAnalysisJobPhase;
  createdAt: string;
  updatedAt: string;
  report?: PrototypeAnalysisReport;
  errorMessage?: string;
}

export interface RecorderCaptureRequest {
  liveUrl: string;
  durationSeconds?: number;
}

export type RecorderCaptureStatus = 'recording' | 'completed' | 'failed';

export interface RecorderOutputFile {
  path: string;
  name: string;
  sizeBytes: number;
  modifiedAt: string;
}

export interface RecorderCaptureResult {
  id: string;
  liveUrl: string;
  durationSeconds: number;
  status: RecorderCaptureStatus;
  outputDir: string;
  files: RecorderOutputFile[];
  logs: string[];
  startedAt: string;
  finishedAt?: string;
  errorMessage?: string;
}

export interface UploadLocalFileRequest {
  localPath: string;
  objectKey?: string;
}

export interface OssUploadResult {
  bucket: string;
  endpoint?: string;
  objectKey: string;
  fileUrl: string;
  expiresSeconds: number;
}

export interface BrowserRecordingUploadResult extends OssUploadResult {
  originalName: string;
  sizeBytes: number;
}

export interface MultipartUploadInitRequest {
  fileName: string;
  sizeBytes: number;
  contentType?: string;
}

export interface MultipartUploadInitResult {
  uploadId: string;
  chunkSizeBytes: number;
  totalParts: number;
  maxFileSizeBytes: number;
}

export interface MultipartUploadPartResult {
  partNumber: number;
  uploadedBytes: number;
}

export interface MultipartUploadCompleteRequest {
  uploadId: string;
}

export interface TranscriptSegmentSummary {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  wordCount: number;
  matchedStage: string;
}

export interface ScriptFinding {
  id: string;
  type: FindingType;
  riskLevel: RiskLevel;
  startSeconds: number;
  originalText: string;
  matchedRule: string;
  analysis: string;
  suggestion: string;
  replacementScript: string;
}

export interface FrameworkMatchSummary {
  stageName: string;
  status: 'matched' | 'weak' | 'missing' | 'not_applicable';
  expectedWindow?: string;
  evidence: string;
  suggestion: string;
}

export interface RagReferenceSummary {
  id: string;
  type: 'framework' | 'risk_rule' | 'case_sample' | 'rewrite_template';
  title: string;
  excerpt: string;
  score: number;
}

export interface AgentTraceStep {
  nodeName: string;
  status: 'completed';
  output: string;
}

export interface PrototypeAnalysisReport {
  id: string;
  title: string;
  inputSource: InputSource;
  durationSeconds: number;
  transcriptWordCount: number;
  frameworkName: string;
  summary: {
    totalFindings: number;
    highRiskFindings: number;
    rewriteSuggestions: number;
    overallDiagnosis: string;
  };
  transcriptSegments: TranscriptSegmentSummary[];
  findings: ScriptFinding[];
  frameworkMatches: FrameworkMatchSummary[];
  ragReferences: RagReferenceSummary[];
  agentTrace: AgentTraceStep[];
}

export interface HistoryReportSummary {
  id: string;
  title: string;
  inputSource: InputSource;
  durationSeconds: number;
  transcriptWordCount: number;
  frameworkName: string;
  score: number;
  totalFindings: number;
  highRiskFindings: number;
  createdAt: string;
  owner: Pick<InternalUser, 'id' | 'username' | 'displayName'>;
}

export interface HistoryReportListResponse {
  items: HistoryReportSummary[];
  total: number;
}

export interface HistoryReportDetail {
  report: PrototypeAnalysisReport;
  createdAt: string;
  owner: Pick<InternalUser, 'id' | 'username' | 'displayName'>;
}

export type ReportChatRole = 'user' | 'assistant';

export interface ReportChatMessage {
  role: ReportChatRole;
  content: string;
}

export interface ReportChatRequest {
  report: PrototypeAnalysisReport;
  question: string;
  messages?: ReportChatMessage[];
}

export type ReportAnswerConfidence = 'high' | 'medium' | 'low';
export type ReportChatFallbackReason =
  | 'model_not_configured'
  | 'submission_missing'
  | 'validation_failed'
  | 'agent_failed';

export interface ReportChatEvidence {
  validated: boolean;
  confidence: ReportAnswerConfidence;
  citationCount: number;
  fallbackUsed: boolean;
  source: 'react_validated' | 'local_fallback';
  fallbackReason?: ReportChatFallbackReason;
}

export interface ReportChatResponse {
  answer: string;
  relatedSegments: TranscriptSegmentSummary[];
  evidence: ReportChatEvidence;
}

export type LiveDataProvider =
  | 'mock_third_party'
  | 'chanmama'
  | 'kaogujia'
  | 'custom_csv';

export interface LiveDataReplayRequest {
  report: PrototypeAnalysisReport;
  provider?: LiveDataProvider;
}

export interface LiveMetricPoint {
  second: number;
  timeLabel: string;
  onlineUsers: number;
  interactions: number;
  productClicks: number;
  orders: number;
  conversionRate: number;
  note?: string;
}

export interface LiveDataInsight {
  id: string;
  startSeconds: number;
  endSeconds: number;
  title: string;
  severity: RiskLevel;
  metricChange: string;
  relatedText: string;
  diagnosis: string;
  suggestion: string;
}

export interface LiveDataReplayResult {
  provider: LiveDataProvider;
  sourceLabel: string;
  generatedAt: string;
  points: LiveMetricPoint[];
  insights: LiveDataInsight[];
  summary: {
    peakOnlineUsers: number;
    averageOnlineUsers: number;
    totalInteractions: number;
    totalProductClicks: number;
    totalOrders: number;
    conversionRate: number;
    keyDropCount: number;
    overallDiagnosis: string;
  };
}

export type FeishuSyncStatus = 'synced' | 'not_configured' | 'failed';

export interface FeishuSyncRequest {
  report: PrototypeAnalysisReport;
  reviewScript: string;
}

export interface FeishuSyncResult {
  status: FeishuSyncStatus;
  title: string;
  message: string;
  contentMarkdown: string;
  documentId?: string;
  documentUrl?: string;
}
