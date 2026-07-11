import type { AxiosResponse } from 'axios';

import type {
  BrowserRecordingUploadResult,
  OssUploadResult,
  UploadLocalFileRequest,
} from '@shared/api.interface';
import { apiClient } from './http';

export async function uploadLocalFile(
  request: UploadLocalFileRequest,
): Promise<OssUploadResult> {
  const response: AxiosResponse<OssUploadResult> = await apiClient({
    url: '/api/storage/upload-local-file',
    method: 'POST',
    data: request,
  });
  return response.data;
}

export async function uploadRecordingFile(
  file: File,
): Promise<BrowserRecordingUploadResult> {
  const formData: FormData = new FormData();
  formData.append('file', file);

  const response: AxiosResponse<BrowserRecordingUploadResult> = await apiClient(
    {
      url: '/api/storage/upload-recording',
      method: 'POST',
      data: formData,
    },
  );
  return response.data;
}
