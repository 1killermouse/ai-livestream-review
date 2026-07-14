import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { MAX_RECORDING_FILE_SIZE_BYTES, OssService } from './oss.service';

interface MockOssClient {
  initMultipartUpload: jest.Mock;
  uploadPart: jest.Mock;
  completeMultipartUpload: jest.Mock;
  abortMultipartUpload: jest.Mock;
  signatureUrl: jest.Mock;
}

describe('OssService', () => {
  let service: OssService;

  beforeEach(() => {
    process.env.ALIYUN_OSS_ACCESS_KEY_ID = 'test-key';
    process.env.ALIYUN_OSS_ACCESS_KEY_SECRET = 'test-secret';
    process.env.ALIYUN_OSS_BUCKET = 'test-bucket';
    process.env.ALIYUN_OSS_REGION = 'oss-cn-hangzhou';
    service = new OssService();
  });

  it('rejects local files outside the recorder output directory', async () => {
    await expect(
      service.uploadLocalFile({
        localPath: path.resolve(process.cwd(), '.env.example'),
      }),
    ).rejects.toThrow('只允许上传本项目生成的直播录屏');
  });

  it('uploads and completes a multipart recording', async () => {
    const client: MockOssClient = {
      initMultipartUpload: jest.fn().mockResolvedValue({
        name: 'test.mp4',
        uploadId: 'upload-1',
      }),
      uploadPart: jest.fn().mockResolvedValue({
        name: 'test.mp4',
        etag: 'etag-1',
      }),
      completeMultipartUpload: jest.fn().mockResolvedValue({
        name: 'test.mp4',
      }),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      signatureUrl: jest.fn().mockReturnValue('https://example.com/test.mp4'),
    };
    jest
      .spyOn(
        service as unknown as { createClient: () => MockOssClient },
        'createClient',
      )
      .mockReturnValue(client);

    const upload = await service.initializeMultipartUpload(
      { fileName: 'test.mp4', sizeBytes: 5, contentType: 'video/mp4' },
      'owner-1',
    );
    const tempDir: string = fs.mkdtempSync(
      path.join(os.tmpdir(), 'zhibo-upload-'),
    );
    const partPath: string = path.join(tempDir, 'part-1');
    fs.writeFileSync(partPath, Buffer.from('12345'));

    await service.uploadMultipartPart(
      { originalname: 'part-1', path: partPath, size: 5 },
      upload.uploadId,
      1,
      'owner-1',
    );
    const result = await service.completeMultipartUpload(
      { uploadId: upload.uploadId },
      'owner-1',
    );

    expect(client.uploadPart).toHaveBeenCalledWith(
      expect.any(String),
      'upload-1',
      1,
      partPath,
      0,
      5,
    );
    expect(client.completeMultipartUpload).toHaveBeenCalledWith(
      expect.any(String),
      'upload-1',
      [{ number: 1, etag: 'etag-1' }],
    );
    expect(result).toMatchObject({
      fileUrl: 'https://example.com/test.mp4',
      originalName: 'test.mp4',
      sizeBytes: 5,
    });
    expect(fs.existsSync(partPath)).toBe(false);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects recordings larger than the ASR limit', async () => {
    await expect(
      service.initializeMultipartUpload(
        {
          fileName: 'too-large.mp4',
          sizeBytes: MAX_RECORDING_FILE_SIZE_BYTES + 1,
        },
        'owner-1',
      ),
    ).rejects.toThrow('单个录屏文件不能超过 2 GB');
  });

  it('does not allow another account to reuse an upload task', async () => {
    const client: MockOssClient = {
      initMultipartUpload: jest.fn().mockResolvedValue({
        name: 'test.mp4',
        uploadId: 'upload-2',
      }),
      uploadPart: jest.fn(),
      completeMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn(),
      signatureUrl: jest.fn(),
    };
    jest
      .spyOn(
        service as unknown as { createClient: () => MockOssClient },
        'createClient',
      )
      .mockReturnValue(client);
    const upload = await service.initializeMultipartUpload(
      { fileName: 'test.mp4', sizeBytes: 5 },
      'owner-1',
    );

    await expect(
      service.completeMultipartUpload({ uploadId: upload.uploadId }, 'owner-2'),
    ).rejects.toThrow('上传任务不存在或已失效');
  });
});
