import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as path from 'path';

import type {
  BrowserRecordingUploadResult,
  OssUploadResult,
  UploadLocalFileRequest,
} from '@shared/api.interface';

import { OssService, type UploadedRecordingFile } from './oss.service';

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
}
