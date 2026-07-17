import { Injectable } from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';

import type { TranscriptSegmentSummary } from '@shared/api.interface';

interface AliyunWord {
  begin_time?: number;
  end_time?: number;
  text?: string;
  punctuation?: string;
}

interface AliyunSentence {
  begin_time?: number;
  end_time?: number;
  text?: string;
  sentence_id?: number;
  speaker_id?: number;
  words?: AliyunWord[];
}

interface AliyunTranscript {
  text?: string;
  sentences?: AliyunSentence[];
}

interface AliyunTranscriptionJson {
  transcripts?: AliyunTranscript[];
}

interface AliyunSubmitTaskResponse {
  output?: {
    task_id?: string;
    task_status?: string;
  };
  request_id?: string;
}

interface AliyunTaskResult {
  file_url?: string;
  transcription_url?: string;
  subtask_status?: string;
  code?: string;
  message?: string;
}

interface AliyunQueryTaskResponse {
  output?: {
    task_id?: string;
    task_status?: string;
    results?: AliyunTaskResult[];
  };
  request_id?: string;
}

@Injectable()
export class AliyunAsrService {
  isConfigured(): boolean {
    return Boolean(process.env.ALIYUN_DASHSCOPE_API_KEY);
  }

  getModelName(): string {
    return process.env.ALIYUN_ASR_MODEL || 'paraformer-v2';
  }

  async transcribeFileUrl(
    fileUrl: string,
  ): Promise<TranscriptSegmentSummary[]> {
    const taskId: string = await this.submitTranscriptionTask(fileUrl);
    const transcriptionUrl: string = await this.waitForTranscriptionUrl(taskId);
    const response: AxiosResponse<AliyunTranscriptionJson> =
      await axios.get<AliyunTranscriptionJson>(transcriptionUrl);
    return this.normalizeTranscriptionResult(response.data);
  }

  async submitTranscriptionTask(fileUrl: string): Promise<string> {
    const response: AxiosResponse<AliyunSubmitTaskResponse> =
      await axios.post<AliyunSubmitTaskResponse>(
        `${this.getBaseUrl()}/api/v1/services/audio/asr/transcription`,
        {
          model: this.getModelName(),
          input: {
            file_urls: [fileUrl],
          },
          parameters: {
            channel_id: [0],
            disfluency_removal_enabled: false,
            timestamp_alignment_enabled: true,
            language_hints: ['zh', 'en'],
            special_word_filter: JSON.stringify({
              system_reserved_filter: false,
            }),
          },
        },
        {
          headers: this.getRequestHeaders(true),
        },
      );
    const taskId: string | undefined = response.data.output?.task_id;
    if (!taskId) {
      throw new Error('阿里 ASR 未返回 task_id');
    }
    return taskId;
  }

  async waitForTranscriptionUrl(taskId: string): Promise<string> {
    const maxAttempts: number = 60;
    for (let attempt: number = 0; attempt < maxAttempts; attempt += 1) {
      const response: AxiosResponse<AliyunQueryTaskResponse> =
        await axios.post<AliyunQueryTaskResponse>(
          `${this.getBaseUrl()}/api/v1/tasks/${taskId}`,
          undefined,
          {
            headers: this.getRequestHeaders(false),
          },
        );
      const status: string | undefined = response.data.output?.task_status;
      if (status === 'SUCCEEDED') {
        const result: AliyunTaskResult | undefined =
          response.data.output?.results?.[0];
        if (result?.subtask_status === 'FAILED') {
          throw new Error(result.message || '阿里 ASR 子任务失败');
        }
        if (!result?.transcription_url) {
          throw new Error('阿里 ASR 未返回 transcription_url');
        }
        return result.transcription_url;
      }
      if (status && status !== 'PENDING' && status !== 'RUNNING') {
        throw new Error(`阿里 ASR 任务失败：${status}`);
      }
      await this.sleep(1000);
    }
    throw new Error('阿里 ASR 任务查询超时');
  }

  normalizeTranscriptionResult(
    rawResult: AliyunTranscriptionJson,
  ): TranscriptSegmentSummary[] {
    const sentences: AliyunSentence[] = (rawResult.transcripts || []).flatMap(
      (transcript: AliyunTranscript): AliyunSentence[] =>
        transcript.sentences || [],
    );

    return sentences
      .filter((sentence: AliyunSentence): boolean =>
        Boolean(sentence.text?.trim()),
      )
      .map(
        (sentence: AliyunSentence, index: number): TranscriptSegmentSummary => {
          const startSeconds: number = this.toStartSeconds(sentence.begin_time);
          const endSeconds: number = this.toEndSeconds(
            sentence.end_time,
            startSeconds,
          );
          const text: string = sentence.text?.trim() || '';

          return {
            id: `asr-${sentence.sentence_id || index + 1}`,
            startSeconds,
            endSeconds,
            text,
            wordCount: this.countTextUnits(text),
            matchedStage: 'unknown',
          };
        },
      );
  }

  buildPrototypeAliyunResult(): AliyunTranscriptionJson {
    return {
      transcripts: [
        {
          text: '如果你是0基础小白，想用AI做副业，今天这场直播先听懂适不适合你。',
          sentences: [
            {
              begin_time: 0,
              end_time: 58000,
              text: '如果你是0基础小白，想用AI做副业，今天这场直播先听懂适不适合你，不适合的人我也会直接告诉你。',
              sentence_id: 1,
            },
            {
              begin_time: 58000,
              end_time: 136000,
              text: '很多人不是不会努力，是不会写提示词，不知道怎么把AI用到短视频、文案和获客里。',
              sentence_id: 2,
            },
            {
              begin_time: 136000,
              end_time: 224000,
              text: '我们的训练营会给你SOP、提示词模板、案例拆解和作业点评，但我不能保证每个人都能变现。',
              sentence_id: 3,
            },
            {
              begin_time: 224000,
              end_time: 326000,
              text: '跟着我这套训练营做，一键生成爆款内容，保证你一个月用AI变现，0基础小白七天就能接单回本。',
              sentence_id: 4,
            },
          ],
        },
      ],
    };
  }

  private toStartSeconds(value: number | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return 0;
    }
    return Math.max(0, Math.floor(value / 1000));
  }

  private toEndSeconds(
    value: number | undefined,
    startSeconds: number,
  ): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return startSeconds + 1;
    }
    return Math.max(startSeconds + 1, Math.ceil(value / 1000));
  }

  private countTextUnits(text: string): number {
    const chineseChars: RegExpMatchArray | null =
      text.match(/[\u4e00-\u9fff]/g);
    const latinTokens: RegExpMatchArray | null = text.match(/[a-zA-Z0-9]+/g);
    return (chineseChars?.length || 0) + (latinTokens?.length || 0);
  }

  private getBaseUrl(): string {
    return (
      process.env.ALIYUN_DASHSCOPE_BASE_URL?.replace(/\/$/, '') ||
      'https://dashscope.aliyuncs.com'
    );
  }

  private getRequestHeaders(asyncTask: boolean): Record<string, string> {
    const apiKey: string | undefined = process.env.ALIYUN_DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('缺少 ALIYUN_DASHSCOPE_API_KEY');
    }

    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(asyncTask ? { 'X-DashScope-Async': 'enable' } : {}),
    };
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve: () => void) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
