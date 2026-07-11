import * as path from 'path';

import { OssService } from './oss.service';

describe('OssService', () => {
  const service = new OssService();

  it('rejects local files outside the recorder output directory', async () => {
    await expect(
      service.uploadLocalFile({
        localPath: path.resolve(process.cwd(), '.env.example'),
      }),
    ).rejects.toThrow('只允许上传本项目生成的直播录屏');
  });
});
