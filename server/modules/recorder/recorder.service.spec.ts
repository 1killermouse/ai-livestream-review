import { RecorderService } from './recorder.service';

describe('RecorderService', () => {
  it('rejects non-http recording sources before starting a process', async () => {
    const service = new RecorderService();

    await expect(
      service.captureLive({ liveUrl: 'file:///tmp/not-a-live-room' }),
    ).rejects.toThrow('仅支持 HTTP 或 HTTPS');
  });

  it('rejects links containing embedded credentials', async () => {
    const service = new RecorderService();

    await expect(
      service.captureLive({ liveUrl: 'https://user:pass@example.com/live' }),
    ).rejects.toThrow('不能包含账号或密码');
  });
});
