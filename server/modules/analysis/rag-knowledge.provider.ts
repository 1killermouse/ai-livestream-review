import { Injectable } from '@nestjs/common';

import type { RagReferenceSummary } from '@shared/api.interface';

import { AliyunEmbeddingService } from './aliyun-embedding.service';

interface KnowledgeDocument {
  id: string;
  type: RagReferenceSummary['type'];
  title: string;
  content: string;
  keywords: string[];
}

interface EmbeddedKnowledgeDocument {
  document: KnowledgeDocument;
  embedding: number[];
}

const DEFAULT_KNOWLEDGE_DOCUMENTS: KnowledgeDocument[] = [
  {
    id: 'framework-0-60-value-anxiety-demo',
    type: 'framework',
    title: '0-60 分钟：焦虑唤醒 + AI 干货案例',
    content:
      '前 60 分钟的业务目标是先让用户觉得直播间有价值。可以适度唤醒用户对 AI 落后、效率低、不会工具的焦虑，然后手把手带直播间用户做一个简单 AI 案例。注意：焦虑表达要控制边界，不能恐吓用户，不要说不学 AI 就废了、一定被淘汰。',
    keywords: ['焦虑', '干货', '案例', '手把手', 'AI', '工具', '模板', '实操'],
  },
  {
    id: 'framework-60-84-course-offer',
    type: 'framework',
    title: '60-84 分钟：课程承接 + 权益说明 + 抛价格',
    content:
      '60-84 分钟从免费案例承接到系统课程：说明这里有一整套手把手带用户学习 AI、做案例、练习交付的课程，并抛出价格和权益。重点讲清课程交付、服务、答疑、陪跑、作业点评和工具包，不要只靠变现承诺卖课。',
    keywords: ['课程', '权益', '价格', '交付', '服务', '陪跑', '答疑', '作业'],
  },
  {
    id: 'framework-84-90-case-persona',
    type: 'framework',
    title: '84-90 分钟：成功案例 + 继续立人设',
    content:
      '84-90 分钟通过成功案例继续立人设。案例可以讲三十岁宝妈边带孩子边做副业得到结果，服装店老板跟着做转型，在家做自媒体拿到改善。但案例必须补充基础、执行动作、投入时间和不可保证复制。',
    keywords: ['案例', '宝妈', '服装店老板', '副业', '自媒体', '结果', '人设'],
  },
  {
    id: 'framework-after-90-closing',
    type: 'framework',
    title: '90 分钟后：持续成交承接',
    content:
      '90 分钟后可以持续成交承接和逼单，但要强调真实权益、服务交付和平台内报名路径。可以再次强调交付和服务，不要使用虚假名额、过度稀缺、站外付款或无法证明的最后机会。',
    keywords: ['逼单', '成交', '报名', '权益', '交付', '服务', '名额', '平台'],
  },
  {
    id: 'risk-pending-banned-words',
    type: 'risk_rule',
    title: '待导入正式违禁词库',
    content:
      '正式违禁词由用户后续整理导入。当前仅保留风险样例：包赚钱、包教会、保证变现、很容易拿结果、躺赚、一键赚钱、最后名额、加微信付款、创业收益承诺等。',
    keywords: [
      '包赚钱',
      '包教会',
      '保证变现',
      '很容易',
      '拿结果',
      '躺赚',
      '创业',
    ],
  },
  {
    id: 'risk-ai-case-boundary',
    type: 'risk_rule',
    title: '案例结果边界',
    content:
      '案例不能只讲结果和收益，需要补充学员基础、执行动作、投入时间、适用条件和结果不可保证复制。尤其是宝妈、副业、实体店转型、自媒体变现这类案例，容易被用户理解为普遍收益承诺。',
    keywords: ['案例', '结果', '宝妈', '副业', '实体店', '自媒体', '不可保证'],
  },
  {
    id: 'case-mom-side-business',
    type: 'case_sample',
    title: '案例样本：三十岁宝妈副业',
    content:
      '三十岁宝妈边带孩子边学习 AI 副业，跟着课程做简单案例并逐步得到结果。报告分析时应检查是否交代了基础、时间投入、执行动作和不可保证复制。',
    keywords: ['三十岁', '宝妈', '带孩子', '副业', '结果'],
  },
  {
    id: 'case-clothing-store-owner',
    type: 'case_sample',
    title: '案例样本：服装店老板转型自媒体',
    content:
      '服装店老板跟着做 AI 转型，在家做自媒体，尝试用 AI 提升内容生产和获客效率。报告分析时应检查是否把转型过程说清楚，避免只说成功结果。',
    keywords: ['服装店老板', '转型', '自媒体', 'AI', '获客'],
  },
];

@Injectable()
export class RagKnowledgeProvider {
  private embeddedDocuments: EmbeddedKnowledgeDocument[] | null = null;
  private lastRetrievalMode: 'embedding' | 'keyword' = 'keyword';

  constructor(
    private readonly aliyunEmbeddingService: AliyunEmbeddingService,
  ) {}

  isEmbeddingConfigured(): boolean {
    return this.aliyunEmbeddingService.isConfigured();
  }

  getEmbeddingModelName(): string {
    return this.aliyunEmbeddingService.getModelName();
  }

  getEmbeddingDimensions(): number {
    return this.aliyunEmbeddingService.getDimensions();
  }

  getLastRetrievalMode(): 'embedding' | 'keyword' {
    return this.lastRetrievalMode;
  }

  async retrieve(
    query: string,
    limit: number = 5,
  ): Promise<RagReferenceSummary[]> {
    if (this.aliyunEmbeddingService.isConfigured() && query.trim().length > 0) {
      try {
        const references: RagReferenceSummary[] =
          await this.retrieveByEmbedding(query, limit);
        if (references.length > 0) {
          this.lastRetrievalMode = 'embedding';
          return references;
        }
      } catch {
        this.lastRetrievalMode = 'keyword';
      }
    }

    this.lastRetrievalMode = 'keyword';
    return this.retrieveByKeyword(query, limit);
  }

  private async retrieveByEmbedding(
    query: string,
    limit: number,
  ): Promise<RagReferenceSummary[]> {
    const embeddedDocuments: EmbeddedKnowledgeDocument[] =
      await this.getEmbeddedDocuments();
    const queryEmbedding: number[] =
      await this.aliyunEmbeddingService.embedText(query);
    if (queryEmbedding.length === 0) {
      return [];
    }

    return embeddedDocuments
      .map((embeddedDocument: EmbeddedKnowledgeDocument) => ({
        document: embeddedDocument.document,
        score: this.cosineSimilarity(
          queryEmbedding,
          embeddedDocument.embedding,
        ),
      }))
      .filter(
        (candidate: { document: KnowledgeDocument; score: number }): boolean =>
          candidate.score > 0,
      )
      .sort(
        (
          left: { document: KnowledgeDocument; score: number },
          right: { document: KnowledgeDocument; score: number },
        ): number => right.score - left.score,
      )
      .slice(0, limit)
      .map(
        (candidate: {
          document: KnowledgeDocument;
          score: number;
        }): RagReferenceSummary => ({
          id: candidate.document.id,
          type: candidate.document.type,
          title: candidate.document.title,
          excerpt: candidate.document.content,
          score: Math.round(candidate.score * 100),
        }),
      );
  }

  retrieveByKeyword(query: string, limit: number): RagReferenceSummary[] {
    this.lastRetrievalMode = 'keyword';
    const normalizedQuery: string = query.toLowerCase();
    return DEFAULT_KNOWLEDGE_DOCUMENTS.map((document: KnowledgeDocument) => ({
      document,
      score: this.scoreDocument(document, normalizedQuery),
    }))
      .filter(
        (candidate: { document: KnowledgeDocument; score: number }): boolean =>
          candidate.score > 0,
      )
      .sort(
        (
          left: { document: KnowledgeDocument; score: number },
          right: { document: KnowledgeDocument; score: number },
        ): number => right.score - left.score,
      )
      .slice(0, limit)
      .map(
        (candidate: {
          document: KnowledgeDocument;
          score: number;
        }): RagReferenceSummary => ({
          id: candidate.document.id,
          type: candidate.document.type,
          title: candidate.document.title,
          excerpt: candidate.document.content,
          score: candidate.score,
        }),
      );
  }

  private async getEmbeddedDocuments(): Promise<EmbeddedKnowledgeDocument[]> {
    if (this.embeddedDocuments) {
      return this.embeddedDocuments;
    }

    const texts: string[] = DEFAULT_KNOWLEDGE_DOCUMENTS.map(
      (document: KnowledgeDocument): string =>
        `${document.title}\n${document.content}`,
    );
    const embeddings: number[][] =
      await this.aliyunEmbeddingService.embedTexts(texts);
    this.embeddedDocuments = DEFAULT_KNOWLEDGE_DOCUMENTS.map(
      (
        document: KnowledgeDocument,
        index: number,
      ): EmbeddedKnowledgeDocument => ({
        document,
        embedding: embeddings[index] || [],
      }),
    ).filter(
      (embeddedDocument: EmbeddedKnowledgeDocument): boolean =>
        embeddedDocument.embedding.length > 0,
    );
    return this.embeddedDocuments;
  }

  private cosineSimilarity(left: number[], right: number[]): number {
    const length: number = Math.min(left.length, right.length);
    if (length === 0) {
      return 0;
    }

    let dotProduct: number = 0;
    let leftNorm: number = 0;
    let rightNorm: number = 0;
    for (let index = 0; index < length; index += 1) {
      dotProduct += left[index] * right[index];
      leftNorm += left[index] * left[index];
      rightNorm += right[index] * right[index];
    }

    if (leftNorm === 0 || rightNorm === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
  }

  private scoreDocument(document: KnowledgeDocument, query: string): number {
    const content: string =
      `${document.title} ${document.content}`.toLowerCase();
    let score: number = 0;
    for (const keyword of document.keywords) {
      const normalizedKeyword: string = keyword.toLowerCase();
      if (query.includes(normalizedKeyword)) {
        score += 3;
      }
      if (
        content.includes(normalizedKeyword) &&
        query.includes(normalizedKeyword)
      ) {
        score += 1;
      }
    }
    if (query.includes('ai') && content.includes('ai')) {
      score += 1;
    }
    return score;
  }
}
