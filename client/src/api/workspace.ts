import type { AxiosResponse } from 'axios';

import type {
  AnalysisCapability,
  WorkspaceOverviewResponse,
} from '@shared/api.interface';
import { apiClient } from './http';

export async function getOverview(): Promise<WorkspaceOverviewResponse> {
  const response: AxiosResponse<WorkspaceOverviewResponse> = await apiClient({
    url: '/api/workspace/overview',
    method: 'GET',
  });
  return response.data;
}

export async function getAnalysisCapability(): Promise<AnalysisCapability> {
  const response: AxiosResponse<AnalysisCapability> = await apiClient({
    url: '/api/analysis/capability',
    method: 'GET',
  });
  return response.data;
}
