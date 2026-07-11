import type { AxiosResponse } from 'axios';

import type {
  RecorderCaptureRequest,
  RecorderCaptureResult,
} from '@shared/api.interface';
import { apiClient } from './http';

export async function captureLive(
  request: RecorderCaptureRequest,
): Promise<RecorderCaptureResult> {
  const response: AxiosResponse<RecorderCaptureResult> = await apiClient({
    url: '/api/recorder/capture',
    method: 'POST',
    data: request,
  });
  return response.data;
}

export async function getCaptureStatus(
  id: string,
): Promise<RecorderCaptureResult> {
  const response: AxiosResponse<RecorderCaptureResult> = await apiClient({
    url: `/api/recorder/capture/${id}`,
    method: 'GET',
  });
  return response.data;
}
