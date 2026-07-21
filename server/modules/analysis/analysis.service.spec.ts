import type { TranscriptSegmentSummary } from '@shared/api.interface';

import { AliyunAsrService } from './aliyun-asr.service';
import { AnalysisService } from './analysis.service';
import { DeepSeekAnalysisService } from './deepseek-analysis.service';
import { LiveScriptPolicyProvider } from './live-script-policy.provider';
import { RagKnowledgeProvider } from './rag-knowledge.provider';
import { ReportReactAgentService } from './report-react-agent.service';
import { RewriteAdviceAgentService } from './rewrite-advice-agent.service';
import { RhythmAnalysisAgentService } from './rhythm-analysis-agent.service';
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
    const rhythmAnalysisAgentService = {
      analyze: jest.fn().mockImplementation(async ({ baselineMatches }) => ({
        frameworkMatches: baselineMatches,
        statusText: '测试节奏诊断完成',
        usedAgent: false,
      })),
    } as unknown as RhythmAnalysisAgentService;
    const rewriteAdviceAgentService = {
      rewrite: jest.fn().mockImplementation(async ({ findings }) => ({
        findings,
        reviewScript: '测试复盘改稿',
        statusText: '测试整改完成',
        usedAgent: false,
      })),
    } as unknown as RewriteAdviceAgentService;
    const service = new AnalysisService(
      {} as LiveScriptPolicyProvider,
      aliyunAsrService,
      ragKnowledgeProvider,
      deepSeekAnalysisService,
      {} as ReportReactAgentService,
      rhythmAnalysisAgentService,
      rewriteAdviceAgentService,
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
      reviewScript: '测试复盘改稿',
    });
    expect(aliyunAsrService.transcribeFileUrl).toHaveBeenCalledTimes(1);
    expect(historyService.saveReport).toHaveBeenCalledWith(
      'anchor-1',
      expect.objectContaining({ title: '测试录屏.mp4' }),
    );
    expect(rhythmAnalysisAgentService.analyze).toHaveBeenCalledTimes(1);
    expect(rewriteAdviceAgentService.rewrite).toHaveBeenCalledTimes(1);

    (
      aliyunAsrService.transcribeFileUrl as jest.MockedFunction<
        AliyunAsrService['transcribeFileUrl']
      >
    ).mockResolvedValueOnce([
      {
        id: 'segment-warning',
        startSeconds: 0,
        endSeconds: 18,
        text: '如果有人跟你说保证一个月赚钱，这种说法就要谨慎。',
        wordCount: 22,
        matchedStage: 'unknown',
      },
    ]);
    const warningJob = service.startFileAnalysisJob(
      {
        inputSource: 'recording_upload',
        recordingName: '提醒语境.mp4',
        fileUrl: 'https://example.com/warning.mp4',
      },
      'anchor-1',
    );
    let warningResult = service.getFileAnalysisJob(warningJob.id, anchorUser);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (warningResult.status !== 'processing') {
        break;
      }
      await new Promise((resolve: () => void) => setTimeout(resolve, 0));
      warningResult = service.getFileAnalysisJob(warningJob.id, anchorUser);
    }

    expect(warningResult.report?.findings).toEqual([]);
  });
});
