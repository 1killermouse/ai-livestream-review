import type { AxiosResponse } from 'axios';

import type {
  BrowserRecordingUploadResult,
  MultipartUploadCompleteRequest,
  MultipartUploadInitRequest,
  MultipartUploadInitResult,
  MultipartUploadPartResult,
  OssUploadResult,
  UploadLocalFileRequest,
} from '@shared/api.interface';
import { apiClient } from './http';

const MULTIPART_UPLOAD_CONCURRENCY = 3;
const MULTIPART_UPLOAD_MAX_ATTEMPTS = 3;

export type RecordingUploadProgressHandler = (percentage: number) => void;

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
  onProgress?: RecordingUploadProgressHandler,
): Promise<BrowserRecordingUploadResult> {
  const initRequest: MultipartUploadInitRequest = {
    fileName: file.name,
    sizeBytes: file.size,
    contentType: file.type || undefined,
  };
  const initResponse: AxiosResponse<MultipartUploadInitResult> =
    await apiClient({
      url: '/api/storage/multipart/init',
      method: 'POST',
      data: initRequest,
    });
  const upload: MultipartUploadInitResult = initResponse.data;
  let nextPartNumber = 1;
  let uploadedBytes = 0;

  const uploadWorker = async (): Promise<void> => {
    while (nextPartNumber <= upload.totalParts) {
      const partNumber: number = nextPartNumber;
      nextPartNumber += 1;
      const start: number = (partNumber - 1) * upload.chunkSizeBytes;
      const end: number = Math.min(start + upload.chunkSizeBytes, file.size);
      const chunk: Blob = file.slice(start, end);

      await uploadPartWithRetry(upload.uploadId, partNumber, chunk);
      uploadedBytes += chunk.size;
      onProgress?.(
        Math.min(100, Math.round((uploadedBytes / file.size) * 100)),
      );
    }
  };

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(MULTIPART_UPLOAD_CONCURRENCY, upload.totalParts) },
        () => uploadWorker(),
      ),
    );
    const completeRequest: MultipartUploadCompleteRequest = {
      uploadId: upload.uploadId,
    };
    const response: AxiosResponse<BrowserRecordingUploadResult> =
      await apiClient({
        url: '/api/storage/multipart/complete',
        method: 'POST',
        data: completeRequest,
      });
    return response.data;
  } catch (error) {
    await apiClient({
      url: '/api/storage/multipart/abort',
      method: 'POST',
      data: { uploadId: upload.uploadId },
    }).catch(() => undefined);
    throw error;
  }
}

async function uploadPartWithRetry(
  uploadId: string,
  partNumber: number,
  chunk: Blob,
): Promise<MultipartUploadPartResult> {
  let lastError: unknown;
  for (
    let attempt: number = 1;
    attempt <= MULTIPART_UPLOAD_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const formData: FormData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('partNumber', String(partNumber));
    formData.append('chunk', chunk, `part-${partNumber}`);

    try {
      const response: AxiosResponse<MultipartUploadPartResult> =
        await apiClient({
          url: '/api/storage/multipart/part',
          method: 'POST',
          data: formData,
          timeout: 120000,
        });
      return response.data;
    } catch (error) {
      lastError = error;
      if (attempt < MULTIPART_UPLOAD_MAX_ATTEMPTS) {
        await new Promise<void>((resolve: () => void) => {
          window.setTimeout(resolve, 400 * 2 ** (attempt - 1));
        });
      }
    }
  }
  throw lastError;
}
