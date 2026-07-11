import { Injectable } from '@nestjs/common';
import OSS from 'ali-oss';
import * as fs from 'fs';
import * as path from 'path';

import type {
  BrowserRecordingUploadResult,
  OssUploadResult,
  UploadLocalFileRequest,
} from '@shared/api.interface';

export interface UploadedRecordingFile {
  originalname: string;
  path: string;
  size: number;
}

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

    const expiresSeconds: number = 48 * 60 * 60;
    const fileUrl: string = client.signatureUrl(objectKey, {
      expires: expiresSeconds,
      method: 'GET',
    });

    return {
      bucket: process.env.ALIYUN_OSS_BUCKET || '',
      endpoint:
        process.env.ALIYUN_OSS_ENDPOINT || process.env.ALIYUN_OSS_REGION,
      objectKey,
      fileUrl,
      expiresSeconds,
    };
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
      throw new Error('仅支持常见音视频文件');
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
