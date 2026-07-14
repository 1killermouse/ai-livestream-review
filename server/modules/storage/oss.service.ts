import { BadRequestException, Injectable } from '@nestjs/common';
import OSS from 'ali-oss';
import * as fs from 'fs';
import * as path from 'path';

import type {
  BrowserRecordingUploadResult,
  MultipartUploadCompleteRequest,
  MultipartUploadInitRequest,
  MultipartUploadInitResult,
  MultipartUploadPartResult,
  OssUploadResult,
  UploadLocalFileRequest,
} from '@shared/api.interface';

export interface UploadedRecordingFile {
  originalname: string;
  path: string;
  size: number;
}

interface MultipartUploadSession {
  uploadId: string;
  ownerId: string;
  objectKey: string;
  originalName: string;
  sizeBytes: number;
  totalParts: number;
  createdAt: number;
  parts: Map<number, { etag: string; sizeBytes: number }>;
}

export const MULTIPART_CHUNK_SIZE_BYTES: number = 4 * 1024 * 1024;
export const MAX_RECORDING_FILE_SIZE_BYTES: number = 2 * 1024 * 1024 * 1024;
const MULTIPART_SESSION_TTL_MS: number = 24 * 60 * 60 * 1000;

const ALLOWED_MEDIA_EXTENSIONS: Set<string> = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.flv',
  '.mkv',
  '.mp3',
  '.m4a',
  '.aac',
  '.wav',
]);

@Injectable()
export class OssService {
  private readonly multipartSessions: Map<string, MultipartUploadSession> =
    new Map();

  isConfigured(): boolean {
    return Boolean(
      process.env.ALIYUN_OSS_ACCESS_KEY_ID &&
      process.env.ALIYUN_OSS_ACCESS_KEY_SECRET &&
      process.env.ALIYUN_OSS_BUCKET &&
      (process.env.ALIYUN_OSS_ENDPOINT || process.env.ALIYUN_OSS_REGION),
    );
  }

  async uploadLocalFile(
    request: UploadLocalFileRequest,
  ): Promise<OssUploadResult> {
    const localPath: string = this.resolveRecorderOutputPath(request.localPath);
    return this.uploadFile(localPath, this.buildObjectKey(localPath));
  }

  async uploadRecordingFile(
    file: UploadedRecordingFile,
  ): Promise<BrowserRecordingUploadResult> {
    try {
      if (!file?.path || !fs.existsSync(file.path)) {
        throw new Error('录屏文件上传失败');
      }
      this.assertAllowedMediaExtension(file.originalname);

      const uploadResult: OssUploadResult = await this.uploadFile(
        file.path,
        this.buildObjectKey(file.originalname),
      );

      return {
        ...uploadResult,
        originalName: file.originalname,
        sizeBytes: file.size,
      };
    } finally {
      if (file?.path) {
        await fs.promises.unlink(file.path).catch(() => undefined);
      }
    }
  }

  async initializeMultipartUpload(
    request: MultipartUploadInitRequest,
    ownerId: string,
  ): Promise<MultipartUploadInitResult> {
    this.assertConfigured();
    this.assertAllowedMediaExtension(request.fileName);
    if (
      !Number.isSafeInteger(request.sizeBytes) ||
      request.sizeBytes <= 0 ||
      request.sizeBytes > MAX_RECORDING_FILE_SIZE_BYTES
    ) {
      throw new BadRequestException('单个录屏文件不能超过 2 GB');
    }

    this.pruneExpiredMultipartUploads();
    const objectKey: string = this.buildObjectKey(request.fileName);
    const client: OSS = this.createClient();
    const result = await client.initMultipartUpload(objectKey, {
      mime: request.contentType || 'application/octet-stream',
    });
    const totalParts: number = Math.ceil(
      request.sizeBytes / MULTIPART_CHUNK_SIZE_BYTES,
    );

    this.multipartSessions.set(result.uploadId, {
      uploadId: result.uploadId,
      ownerId,
      objectKey,
      originalName: request.fileName,
      sizeBytes: request.sizeBytes,
      totalParts,
      createdAt: Date.now(),
      parts: new Map(),
    });

    return {
      uploadId: result.uploadId,
      chunkSizeBytes: MULTIPART_CHUNK_SIZE_BYTES,
      totalParts,
      maxFileSizeBytes: MAX_RECORDING_FILE_SIZE_BYTES,
    };
  }

  async uploadMultipartPart(
    file: UploadedRecordingFile,
    uploadId: string,
    partNumber: number,
    ownerId: string,
  ): Promise<MultipartUploadPartResult> {
    try {
      if (!file?.path || !fs.existsSync(file.path)) {
        throw new BadRequestException('上传分片缺失');
      }
      const session: MultipartUploadSession = this.requireMultipartSession(
        uploadId,
        ownerId,
      );
      if (
        !Number.isInteger(partNumber) ||
        partNumber < 1 ||
        partNumber > session.totalParts
      ) {
        throw new BadRequestException('上传分片序号无效');
      }

      const expectedSize: number = Math.min(
        MULTIPART_CHUNK_SIZE_BYTES,
        session.sizeBytes - (partNumber - 1) * MULTIPART_CHUNK_SIZE_BYTES,
      );
      if (file.size !== expectedSize) {
        throw new BadRequestException('上传分片大小不正确');
      }

      const result = await this.createClient().uploadPart(
        session.objectKey,
        session.uploadId,
        partNumber,
        file.path,
        0,
        file.size,
      );
      session.parts.set(partNumber, {
        etag: result.etag,
        sizeBytes: file.size,
      });

      return { partNumber, uploadedBytes: file.size };
    } finally {
      if (file?.path) {
        await fs.promises.unlink(file.path).catch(() => undefined);
      }
    }
  }

  async completeMultipartUpload(
    request: MultipartUploadCompleteRequest,
    ownerId: string,
  ): Promise<BrowserRecordingUploadResult> {
    const session: MultipartUploadSession = this.requireMultipartSession(
      request.uploadId,
      ownerId,
    );
    const parts = Array.from(session.parts.entries())
      .sort(([left], [right]) => left - right)
      .map(([number, part]) => ({ number, etag: part.etag }));
    const uploadedBytes: number = Array.from(session.parts.values()).reduce(
      (total: number, part): number => total + part.sizeBytes,
      0,
    );
    if (
      parts.length !== session.totalParts ||
      uploadedBytes !== session.sizeBytes
    ) {
      throw new BadRequestException('录屏分片尚未全部上传');
    }

    const client: OSS = this.createClient();
    await client.completeMultipartUpload(
      session.objectKey,
      session.uploadId,
      parts,
    );
    this.multipartSessions.delete(session.uploadId);

    return {
      ...this.buildUploadResult(client, session.objectKey),
      originalName: session.originalName,
      sizeBytes: session.sizeBytes,
    };
  }

  async abortMultipartUpload(uploadId: string, ownerId: string): Promise<void> {
    const session: MultipartUploadSession | undefined =
      this.multipartSessions.get(uploadId);
    if (!session) {
      return;
    }
    if (session.ownerId !== ownerId) {
      throw new BadRequestException('上传任务不存在或已失效');
    }

    this.multipartSessions.delete(uploadId);
    await this.createClient()
      .abortMultipartUpload(session.objectKey, session.uploadId)
      .catch(() => undefined);
  }

  private async uploadFile(
    localPath: string,
    objectKey: string,
  ): Promise<OssUploadResult> {
    this.assertConfigured();
    if (!fs.existsSync(localPath) || !fs.statSync(localPath).isFile()) {
      throw new Error('本地文件不存在');
    }

    const client: OSS = this.createClient();
    await client.put(objectKey, localPath);
    return this.buildUploadResult(client, objectKey);
  }

  private buildUploadResult(client: OSS, objectKey: string): OssUploadResult {
    const expiresSeconds: number = 48 * 60 * 60;
    return {
      bucket: process.env.ALIYUN_OSS_BUCKET || '',
      endpoint:
        process.env.ALIYUN_OSS_ENDPOINT || process.env.ALIYUN_OSS_REGION,
      objectKey,
      fileUrl: client.signatureUrl(objectKey, {
        expires: expiresSeconds,
        method: 'GET',
      }),
      expiresSeconds,
    };
  }

  private requireMultipartSession(
    uploadId: string,
    ownerId: string,
  ): MultipartUploadSession {
    const session: MultipartUploadSession | undefined =
      this.multipartSessions.get(uploadId);
    if (!session || session.ownerId !== ownerId) {
      throw new BadRequestException('上传任务不存在或已失效');
    }
    return session;
  }

  private pruneExpiredMultipartUploads(): void {
    const expiredBefore: number = Date.now() - MULTIPART_SESSION_TTL_MS;
    for (const session of this.multipartSessions.values()) {
      if (session.createdAt > expiredBefore) {
        continue;
      }
      this.multipartSessions.delete(session.uploadId);
      void this.createClient()
        .abortMultipartUpload(session.objectKey, session.uploadId)
        .catch(() => undefined);
    }
  }

  private resolveRecorderOutputPath(requestedPath: string): string {
    const recorderRoot: string = path.resolve(
      process.cwd(),
      '.local/recorder-runs',
    );
    const candidatePath: string = path.resolve(process.cwd(), requestedPath);
    this.assertPathInside(recorderRoot, candidatePath);

    if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isFile()) {
      throw new Error('本地录屏文件不存在');
    }
    this.assertAllowedMediaExtension(candidatePath);

    const realRoot: string = fs.realpathSync(recorderRoot);
    const realPath: string = fs.realpathSync(candidatePath);
    this.assertPathInside(realRoot, realPath);
    return realPath;
  }

  private assertPathInside(rootPath: string, candidatePath: string): void {
    const relativePath: string = path.relative(rootPath, candidatePath);
    const outsideRoot: boolean =
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath);
    if (outsideRoot) {
      throw new Error('只允许上传本项目生成的直播录屏');
    }
  }

  private assertAllowedMediaExtension(filePath: string): void {
    const extension: string = path.extname(filePath).toLowerCase();
    if (!ALLOWED_MEDIA_EXTENSIONS.has(extension)) {
      throw new BadRequestException('仅支持常见音视频文件');
    }
  }

  private createClient(): OSS {
    this.assertConfigured();

    return new OSS({
      accessKeyId: process.env.ALIYUN_OSS_ACCESS_KEY_ID || '',
      accessKeySecret: process.env.ALIYUN_OSS_ACCESS_KEY_SECRET || '',
      bucket: process.env.ALIYUN_OSS_BUCKET || '',
      endpoint: process.env.ALIYUN_OSS_ENDPOINT || undefined,
      region: process.env.ALIYUN_OSS_REGION || undefined,
      secure: true,
    });
  }

  private assertConfigured(): void {
    const missing: string[] = [];
    if (!process.env.ALIYUN_OSS_ACCESS_KEY_ID) {
      missing.push('ALIYUN_OSS_ACCESS_KEY_ID');
    }
    if (!process.env.ALIYUN_OSS_ACCESS_KEY_SECRET) {
      missing.push('ALIYUN_OSS_ACCESS_KEY_SECRET');
    }
    if (!process.env.ALIYUN_OSS_BUCKET) {
      missing.push('ALIYUN_OSS_BUCKET');
    }
    if (!process.env.ALIYUN_OSS_ENDPOINT && !process.env.ALIYUN_OSS_REGION) {
      missing.push('ALIYUN_OSS_ENDPOINT 或 ALIYUN_OSS_REGION');
    }
    if (missing.length > 0) {
      throw new Error(`缺少 OSS 配置：${missing.join(', ')}`);
    }
  }

  private buildObjectKey(localPath: string): string {
    const ext: string = path.extname(localPath) || '.bin';
    const baseName: string = path.basename(localPath, ext).replace(/\W+/g, '-');
    return `zhibo-review/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${baseName}${ext}`;
  }
}
