import type { AxiosResponse } from 'axios';

import type {
  FeishuSyncRequest,
  FeishuSyncResult,
} from '@shared/api.interface';
import { apiClient } from './http';

export async function syncReport(
  request: FeishuSyncRequest,
): Promise<FeishuSyncResult> {
  const response: AxiosResponse<FeishuSyncResult> = await apiClient({
    url: '/api/feishu/sync-report',
    method: 'POST',
    data: request,
  });
  return response.data;
}
