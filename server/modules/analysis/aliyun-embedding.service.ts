import { Injectable } from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';

interface AliyunEmbeddingItem {
  embedding?: number[];
  index?: number;
}

interface AliyunEmbeddingResponse {
  data?: AliyunEmbeddingItem[];
  model?: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

@Injectable()
export class AliyunEmbeddingService {
  isConfigured(): boolean {
    return Boolean(process.env.ALIYUN_DASHSCOPE_API_KEY);
  }

  getModelName(): string {
    return process.env.ALIYUN_EMBEDDING_MODEL || 'text-embedding-v4';
  }

  getDimensions(): number {
    const configuredDimensions: number = Number(
      process.env.ALIYUN_EMBEDDING_DIMENSIONS || 1024,
    );
    return Number.isFinite(configuredDimensions) && configuredDimensions > 0
      ? configuredDimensions
      : 1024;
  }

  async embedText(text: string): Promise<number[]> {
    const embeddings: number[][] = await this.embedTexts([text]);
    return embeddings[0] || [];
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!this.isConfigured()) {
      throw new Error('缺少 ALIYUN_DASHSCOPE_API_KEY');
    }

    const normalizedTexts: string[] = texts
      .map((text: string): string => text.trim())
      .filter((text: string): boolean => text.length > 0);
    if (normalizedTexts.length === 0) {
      return [];
    }

    const chunks: string[][] = [];
    for (let index = 0; index < normalizedTexts.length; index += 10) {
      chunks.push(normalizedTexts.slice(index, index + 10));
    }

    const allEmbeddings: number[][] = [];
    for (const chunk of chunks) {
      const response: AxiosResponse<AliyunEmbeddingResponse> =
        await axios.post<AliyunEmbeddingResponse>(
          `${this.getBaseUrl()}/embeddings`,
          {
            model: this.getModelName(),
            input: chunk.length === 1 ? chunk[0] : chunk,
            dimensions: this.getDimensions(),
            encoding_format: 'float',
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.ALIYUN_DASHSCOPE_API_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          },
        );

      const chunkEmbeddings: number[][] = (response.data.data || [])
        .sort(
          (left: AliyunEmbeddingItem, right: AliyunEmbeddingItem): number =>
            (left.index ?? 0) - (right.index ?? 0),
        )
        .map((item: AliyunEmbeddingItem): number[] => item.embedding || []);
      allEmbeddings.push(...chunkEmbeddings);
    }

    return allEmbeddings;
  }

  private getBaseUrl(): string {
    return (
      process.env.ALIYUN_EMBEDDING_BASE_URL?.replace(/\/$/, '') ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    );
  }
}
