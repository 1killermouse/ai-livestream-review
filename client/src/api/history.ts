import type { AxiosResponse } from 'axios';

import type {
  HistoryReportDetail,
  HistoryReportListResponse,
} from '@shared/api.interface';

import { apiClient } from './http';

export async function listReports(): Promise<HistoryReportListResponse> {
  const response: AxiosResponse<HistoryReportListResponse> = await apiClient({
    url: '/api/history/reports',
    method: 'GET',
  });
  return response.data;
}

export async function getReport(id: string): Promise<HistoryReportDetail> {
  const response: AxiosResponse<HistoryReportDetail> = await apiClient({
    url: `/api/history/reports/${id}`,
    method: 'GET',
  });
  return response.data;
}
