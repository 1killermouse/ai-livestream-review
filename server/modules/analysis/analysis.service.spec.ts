import type { TranscriptSegmentSummary } from '@shared/api.interface';

import { AliyunAsrService } from './aliyun-asr.service';
import { AnalysisService } from './analysis.service';
import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { LiveScriptPolicyProvider } from './live-script-policy.provider';
import { RagKnowledgeProvider } from './rag-knowledge.provider';
import { ReportReactAgentService } from './report-react-agent.service';
import { HistoryService } from '../history/history.service';

describe('AnalysisService', () => {
  it('runs long file analysis as a pollable background job', async () => {
    const transcriptSegments: TranscriptSegmentSummary[] = [
      {
        id: 'segment-1',
        startSeconds: 0,
        endSeconds: 12,
        text: '保证你一个月用AI变现。',
        wordCount: 12,
        matchedStage: 'unknown',
      },
    ];
    const aliyunAsrService = {
      transcribeFileUrl: jest.fn().mockResolvedValue(transcriptSegments),
    } as unknown as AliyunAsrService;
    const ragKnowledgeProvider = {
      retrieve: jest.fn().mockResolvedValue([]),
      getLastRetrievalMode: jest.fn().mockReturnValue('keyword'),
    } as unknown as RagKnowledgeProvider;
    const deepSeekAnalysisService = {
      isConfigured: jest.fn().mockReturnValue(false),
    } as unknown as DeepSeekAnalysisService;
    const historyService = {
      saveReport: jest.fn().mockImplementation(async (_ownerId, report) => ({
        ...report,
        id: '8ceec76e-e0a8-42bb-8a51-d2f60f4d7cc4',
      })),
    } as unknown as HistoryService;
    const service = new AnalysisService(
      {} as LiveScriptPolicyProvider,
      aliyunAsrService,
      ragKnowledgeProvider,
      deepSeekAnalysisService,
      {} as ReportReactAgentService,
      historyService,
    );

    const startedJob = service.startFileAnalysisJob(
      {
        inputSource: 'recording_upload',
        recordingName: '测试录屏.mp4',
        fileUrl: 'https://example.com/test.mp4',
      },
      'anchor-1',
    );

    expect(startedJob).toMatchObject({
      status: 'processing',
      phase: 'transcribing',
    });

    const anchorUser = {
      id: 'anchor-1',
      username: 'anchor_one',
      displayName: '主播一',
      role: 'anchor' as const,
    };
    let completedJob = service.getFileAnalysisJob(startedJob.id, anchorUser);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (completedJob.status !== 'processing') {
        break;
      }
      await new Promise((resolve: () => void) => setTimeout(resolve, 0));
      completedJob = service.getFileAnalysisJob(startedJob.id, anchorUser);
    }

    expect(completedJob.status).toBe('completed');
    expect(completedJob.phase).toBe('completed');
    expect(completedJob.report).toMatchObject({
      title: '测试录屏.mp4',
      durationSeconds: 12,
      transcriptSegments: [
        {
          id: 'segment-1',
          startSeconds: 0,
          endSeconds: 12,
          matchedStage: '干货输出',
        },
      ],
    });
    expect(aliyunAsrService.transcribeFileUrl).toHaveBeenCalledTimes(1);
    expect(historyService.saveReport).toHaveBeenCalledWith(
      'anchor-1',
      expect.objectContaining({ title: '测试录屏.mp4' }),
    );
  });
});
