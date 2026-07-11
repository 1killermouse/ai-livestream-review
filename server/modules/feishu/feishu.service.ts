import { Injectable } from '@nestjs/common';
import axios, { type AxiosResponse } from 'axios';

import type {
  FeishuSyncRequest,
  FeishuSyncResult,
  FrameworkMatchSummary,
  PrototypeAnalysisReport,
  ScriptFinding,
  TranscriptSegmentSummary,
} from '@shared/api.interface';

interface FeishuTokenResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
}

interface FeishuCreateDocumentResponse {
  code?: number;
  msg?: string;
  data?: {
    document?: {
      document_id?: string;
      revision_id?: number;
      url?: string;
    };
    document_id?: string;
    url?: string;
  };
}

interface FeishuConvertResponse {
  code?: number;
  msg?: string;
  data?: {
    blocks?: unknown[];
    first_level_block_ids?: string[];
  };
}

@Injectable()
export class FeishuService {
  async syncReport(request: FeishuSyncRequest): Promise<FeishuSyncResult> {
    if (!request.report) {
      throw new Error('请先生成本场直播体检报告');
    }

    const title: string = this.buildTitle(request.report);
    const contentMarkdown: string = this.buildMarkdown(
      request.report,
      request.reviewScript,
    );

    if (!this.isConfigured()) {
      return {
        status: 'not_configured',
        title,
        contentMarkdown,
        message:
          '飞书应用凭证还未配置。请配置 FEISHU_APP_ID、FEISHU_APP_SECRET 和可选的 FEISHU_DOC_FOLDER_TOKEN 后再同步。',
      };
    }

    try {
      const token: string = await this.getTenantAccessToken();
      const createdDocument: {
        documentId: string;
        documentUrl?: string;
      } = await this.createDocument(token, title);
      await this.insertMarkdown(
        token,
        createdDocument.documentId,
        contentMarkdown,
      );

      return {
        status: 'synced',
        title,
        contentMarkdown,
        documentId: createdDocument.documentId,
        documentUrl: createdDocument.documentUrl,
        message: '已同步到飞书文档。',
      };
    } catch (error: unknown) {
      return {
        status: 'failed',
        title,
        contentMarkdown,
        message:
          error instanceof Error ? error.message : '同步飞书文档失败',
      };
    }
  }

  private isConfigured(): boolean {
    return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
  }

  private async getTenantAccessToken(): Promise<string> {
    const response: AxiosResponse<FeishuTokenResponse> =
      await axios.post<FeishuTokenResponse>(
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
        {
          app_id: process.env.FEISHU_APP_ID,
          app_secret: process.env.FEISHU_APP_SECRET,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 20000,
        },
      );

    if (response.data.code && response.data.code !== 0) {
      throw new Error(response.data.msg || '飞书凭证校验失败');
    }
    if (!response.data.tenant_access_token) {
      throw new Error('飞书没有返回 tenant_access_token');
    }
    return response.data.tenant_access_token;
  }

  private async createDocument(
    token: string,
    title: string,
  ): Promise<{ documentId: string; documentUrl?: string }> {
    const body: Record<string, string> = {
      title,
    };
    if (process.env.FEISHU_DOC_FOLDER_TOKEN) {
      body.folder_token = process.env.FEISHU_DOC_FOLDER_TOKEN;
    }

    const response: AxiosResponse<FeishuCreateDocumentResponse> =
      await axios.post<FeishuCreateDocumentResponse>(
        'https://open.feishu.cn/open-apis/docx/v1/documents',
        body,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

    if (response.data.code && response.data.code !== 0) {
      throw new Error(response.data.msg || '创建飞书文档失败');
    }

    const documentId: string | undefined =
      response.data.data?.document?.document_id ||
      response.data.data?.document_id;
    if (!documentId) {
      throw new Error('飞书没有返回 document_id');
    }

    return {
      documentId,
      documentUrl:
        response.data.data?.document?.url || response.data.data?.url,
    };
  }

  private async insertMarkdown(
    token: string,
    documentId: string,
    markdown: string,
  ): Promise<void> {
    const convertResponse: AxiosResponse<FeishuConvertResponse> =
      await axios.post<FeishuConvertResponse>(
        'https://open.feishu.cn/open-apis/docx/v1/documents/blocks/convert',
        {
          content_type: 'markdown',
          content: markdown,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

    if (convertResponse.data.code && convertResponse.data.code !== 0) {
      throw new Error(convertResponse.data.msg || '飞书文档内容转换失败');
    }

    const blocks: unknown[] = convertResponse.data.data?.blocks || [];
    const firstLevelBlockIds: string[] =
      convertResponse.data.data?.first_level_block_ids || [];
    if (blocks.length === 0 || firstLevelBlockIds.length === 0) {
      return;
    }

    await axios.post(
      `https://open.feishu.cn/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/descendant`,
      {
        children_id: firstLevelBlockIds,
        descendants: blocks,
        index: 0,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );
  }

  private buildTitle(report: PrototypeAnalysisReport): string {
    const dateText: string = new Date().toLocaleDateString('zh-CN');
    return `${dateText} ${report.title}复盘`;
  }

  private buildMarkdown(
    report: PrototypeAnalysisReport,
    reviewScript: string,
  ): string {
    const highRiskFindings: ScriptFinding[] = report.findings.filter(
      (finding: ScriptFinding): boolean =>
        finding.riskLevel === 'critical' || finding.riskLevel === 'high',
    );

    return [
      `# ${this.buildTitle(report)}`,
      `同步时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '## 关键结论',
      report.summary.overallDiagnosis,
      '',
      '## 可直接使用的复盘话术',
      reviewScript || '暂无复盘话术。',
      '',
      '## 优先整改点',
      this.formatFindings(highRiskFindings.length > 0 ? highRiskFindings : report.findings),
      '',
      '## 直播节奏检查',
      this.formatFrameworkMatches(report.frameworkMatches),
      '',
      '## 时间轴节选',
      this.formatTranscript(report.transcriptSegments),
    ].join('\n');
  }

  private formatFindings(findings: ScriptFinding[]): string {
    if (findings.length === 0) {
      return '- 暂未发现明显高风险话术。';
    }

    return findings
      .slice(0, 8)
      .map(
        (finding: ScriptFinding, index: number): string =>
          [
            `${index + 1}. ${this.formatTime(finding.startSeconds)} ${finding.matchedRule}`,
            `   - 原话：${finding.originalText}`,
            `   - 为什么要改：${finding.analysis}`,
            `   - 推荐说法：${finding.replacementScript}`,
          ].join('\n'),
      )
      .join('\n');
  }

  private formatFrameworkMatches(matches: FrameworkMatchSummary[]): string {
    return matches
      .map(
        (match: FrameworkMatchSummary): string =>
          `- ${match.stageName}：${match.evidence} 建议：${match.suggestion}`,
      )
      .join('\n');
  }

  private formatTranscript(segments: TranscriptSegmentSummary[]): string {
    return segments
      .slice(0, 20)
      .map(
        (segment: TranscriptSegmentSummary): string =>
          `- ${this.formatTime(segment.startSeconds)}-${this.formatTime(segment.endSeconds)} ${segment.matchedStage}：${segment.text}`,
      )
      .join('\n');
  }

  private formatTime(seconds: number): string {
    const minutes: number = Math.floor(seconds / 60);
    const remainder: number = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }
}
