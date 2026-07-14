import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
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

import {
  MULTIPART_CHUNK_SIZE_BYTES,
  OssService,
  type UploadedRecordingFile,
} from './oss.service';

const uploadDir: string = path.resolve(process.cwd(), '.local/uploads');
fs.mkdirSync(uploadDir, { recursive: true });

@Controller('api/storage')
export class StorageController {
  constructor(private readonly ossService: OssService) {}

  @Post('upload-local-file')
  async uploadLocalFile(
    @Body() body: UploadLocalFileRequest,
  ): Promise<OssUploadResult> {
    return this.ossService.uploadLocalFile(body);
  }

  @Post('upload-recording')
  @UseInterceptors(
    FileInterceptor('file', {
      dest: uploadDir,
      limits: {
        fileSize: 500 * 1024 * 1024,
      },
    }),
  )
  async uploadRecording(
    @UploadedFile() file: UploadedRecordingFile,
  ): Promise<BrowserRecordingUploadResult> {
    if (!file) {
      throw new BadRequestException('请上传录屏文件');
    }
    return this.ossService.uploadRecordingFile(file);
  }

  @Post('multipart/init')
  async initializeMultipartUpload(
    @Req() request: Request,
    @Body() body: MultipartUploadInitRequest,
  ): Promise<MultipartUploadInitResult> {
    return this.ossService.initializeMultipartUpload(
      body,
      this.requireOwnerId(request),
    );
  }

  @Post('multipart/part')
  @UseInterceptors(
    FileInterceptor('chunk', {
      dest: uploadDir,
      limits: {
        // Multer marks an exact-limit file as truncated, so allow one guard byte.
        fileSize: MULTIPART_CHUNK_SIZE_BYTES + 1,
      },
    }),
  )
  async uploadMultipartPart(
    @Req() request: Request,
    @UploadedFile() file: UploadedRecordingFile,
    @Body() body: { uploadId?: string; partNumber?: string },
  ): Promise<MultipartUploadPartResult> {
    if (!file || !body.uploadId) {
      throw new BadRequestException('上传分片参数不完整');
    }
    return this.ossService.uploadMultipartPart(
      file,
      body.uploadId,
      Number(body.partNumber),
      this.requireOwnerId(request),
    );
  }

  @Post('multipart/complete')
  async completeMultipartUpload(
    @Req() request: Request,
    @Body() body: MultipartUploadCompleteRequest,
  ): Promise<BrowserRecordingUploadResult> {
    return this.ossService.completeMultipartUpload(
      body,
      this.requireOwnerId(request),
    );
  }

  @Post('multipart/abort')
  async abortMultipartUpload(
    @Req() request: Request,
    @Body() body: MultipartUploadCompleteRequest,
  ): Promise<{ aborted: true }> {
    await this.ossService.abortMultipartUpload(
      body.uploadId,
      this.requireOwnerId(request),
    );
    return { aborted: true };
  }

  private requireOwnerId(request: Request): string {
    if (!request.internalUser?.id) {
      throw new BadRequestException('请先登录后再继续');
    }
    return request.internalUser.id;
  }
}
