import type { AxiosResponse } from 'axios';

import type {
  LiveDataReplayRequest,
  LiveDataReplayResult,
} from '@shared/api.interface';
import { apiClient } from './http';

export async function createMockLiveDataReplay(
  request: LiveDataReplayRequest,
): Promise<LiveDataReplayResult> {
  const response: AxiosResponse<LiveDataReplayResult> = await apiClient({
    url: '/api/analytics/mock-live-data-replay',
    method: 'POST',
    data: request,
  });
  return response.data;
}
