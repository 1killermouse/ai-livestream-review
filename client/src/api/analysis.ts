import type { AxiosResponse } from 'axios';

import type {
  AnalysisCapability,
  FileAnalysisJob,
  FileUrlAnalysisRequest,
  PrototypeAnalysisReport,
  PrototypeAnalysisRequest,
  ReportChatRequest,
  ReportChatResponse,
  TranscribeUrlRequest,
  TranscriptSegmentSummary,
} from '@shared/api.interface';
import { apiClient } from './http';

export async function getCapability(): Promise<AnalysisCapability> {
  const response: AxiosResponse<AnalysisCapability> = await apiClient({
    url: '/api/analysis/capability',
    method: 'GET',
  });
  return response.data;
}

export async function createPrototypeReport(
  request: PrototypeAnalysisRequest,
): Promise<PrototypeAnalysisReport> {
  const response: AxiosResponse<PrototypeAnalysisReport> = await apiClient({
    url: '/api/analysis/prototype',
    method: 'POST',
    data: request,
  });
  return response.data;
}

export async function createReportFromFileUrl(
  request: FileUrlAnalysisRequest,
): Promise<PrototypeAnalysisReport> {
  const response: AxiosResponse<PrototypeAnalysisReport> = await apiClient({
    url: '/api/analysis/from-file-url',
    method: 'POST',
    data: request,
  });
  return response.data;
}

export async function startFileAnalysisJob(
  request: FileUrlAnalysisRequest,
): Promise<FileAnalysisJob> {
  const response: AxiosResponse<FileAnalysisJob> = await apiClient({
    url: '/api/analysis/jobs',
    method: 'POST',
    data: request,
  });
  return response.data;
}

export async function getFileAnalysisJob(id: string): Promise<FileAnalysisJob> {
  const response: AxiosResponse<FileAnalysisJob> = await apiClient({
    url: `/api/analysis/jobs/${id}`,
    method: 'GET',
  });
  return response.data;
}

export async function transcribeUrl(
  request: TranscribeUrlRequest,
): Promise<TranscriptSegmentSummary[]> {
  const response: AxiosResponse<TranscriptSegmentSummary[]> = await apiClient({
    url: '/api/analysis/transcribe-url',
    method: 'POST',
    data: request,
  });
  return response.data;
}

export async function chatWithReport(
  request: ReportChatRequest,
): Promise<ReportChatResponse> {
  const response: AxiosResponse<ReportChatResponse> = await apiClient({
    url: '/api/analysis/chat',
    method: 'POST',
    data: request,
  });
  return response.data;
}
