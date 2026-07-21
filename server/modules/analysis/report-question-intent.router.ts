import { Injectable } from '@nestjs/common';

import type { ReportChatMessage } from '@shared/api.interface';

export type ReportQuestionIntent =
  | 'risk_locate'
  | 'risk_explain'
  | 'rewrite'
  | 'rhythm'
  | 'summary_action'
  | 'unknown';

export type ReportToolName =
  | 'get_report_overview'
  | 'search_transcript'
  | 'inspect_risks'
  | 'inspect_framework'
  | 'inspect_rewrite_suggestions'
  | 'retrieve_review_knowledge';

export interface ReportQuestionIntentResult {
  intent: ReportQuestionIntent;
  confidence: 'high' | 'medium' | 'low';
  recommendedTools: ReportToolName[];
  source: 'current_question' | 'conversation_context' | 'fallback';
  searchQuery: string;
  referencedItemIndex?: number;
}

const TOOL_ROUTES: Record<ReportQuestionIntent, ReportToolName[]> = {
  risk_locate: ['inspect_risks', 'search_transcript'],
  risk_explain: [
    'inspect_risks',
    'search_transcript',
    'retrieve_review_knowledge',
  ],
  rewrite: [
    'inspect_rewrite_suggestions',
    'inspect_risks',
    'retrieve_review_knowledge',
  ],
  rhythm: ['inspect_framework', 'search_transcript'],
  summary_action: ['get_report_overview', 'inspect_risks', 'inspect_framework'],
  unknown: ['get_report_overview'],
};

@Injectable()
export class ReportQuestionIntentRouter {
  classify(
    question: string,
    messages: ReportChatMessage[] = [],
  ): ReportQuestionIntentResult {
    const previousQuestion: string | undefined = messages
      .slice()
      .reverse()
      .find((message: ReportChatMessage) => message.role === 'user')?.content;
    const referencedItemIndex: number | undefined =
      this.parseReferencedItemIndex(question);
    const currentIntent: ReportQuestionIntent | undefined =
      this.classifyStandalone(question);
    if (currentIntent) {
      const usesConversationContext: boolean = Boolean(
        previousQuestion &&
        (this.hasContextReference(question) ||
          referencedItemIndex !== undefined),
      );
      return this.buildResult(
        currentIntent,
        'high',
        usesConversationContext ? 'conversation_context' : 'current_question',
        usesConversationContext ? `${previousQuestion} ${question}` : question,
        referencedItemIndex,
      );
    }

    if (this.isContextualFollowup(question)) {
      const previousIntent: ReportQuestionIntent | undefined = previousQuestion
        ? this.classifyStandalone(previousQuestion)
        : undefined;
      if (previousIntent) {
        const contextualIntent: ReportQuestionIntent =
          /为什么|原因|依据/.test(question) &&
          (previousIntent === 'risk_locate' ||
            previousIntent === 'risk_explain')
            ? 'risk_explain'
            : previousIntent;
        return this.buildResult(
          contextualIntent,
          'medium',
          'conversation_context',
          `${previousQuestion} ${question}`,
          referencedItemIndex,
        );
      }
    }

    return this.buildResult('unknown', 'low', 'fallback', question);
  }

  private classifyStandalone(
    rawQuestion: string,
  ): ReportQuestionIntent | undefined {
    const question: string = rawQuestion.replace(/\s+/g, '');
    if (!question) {
      return undefined;
    }

    if (
      /最该.{0,8}改|先改|优先改|总结|整体(?:情况|表现|复盘)|复盘结论|下一场(?:先)?做什么|行动清单/.test(
        question,
      )
    ) {
      return 'summary_action';
    }

    if (
      /怎么改|如何改|改写|重写|替换|换个说法|改成.{0,12}(?:版本|说法|话术)|可播话术|帮我(?:写|改)|生成.{0,8}话术/.test(
        question,
      )
    ) {
      return 'rewrite';
    }

    if (
      /节奏|框架|阶段|环节|干货|课程|权益|案例(?:环节|阶段)|成交(?:环节|阶段)|逼单(?:时机|节奏)|时间分配/.test(
        question,
      )
    ) {
      return 'rhythm';
    }

    const asksForReason: boolean = /为什么|原因|依据|怎么判断|凭什么/.test(
      question,
    );
    const mentionsRisk: boolean =
      /风险|违规|违禁|承诺|夸大|赚钱|收益|保证|逼单|处罚|封禁/.test(question);
    if (asksForReason && mentionsRisk) {
      return 'risk_explain';
    }

    if (
      mentionsRisk ||
      /哪(?:一)?句|哪(?:里|些)|几分钟|什么时间|时间点|定位|最大问题/.test(
        question,
      )
    ) {
      return 'risk_locate';
    }

    return undefined;
  }

  private isContextualFollowup(question: string): boolean {
    return /^(?:这个|这句|那句|这一条|那一条|第[一二三四五六七八九十\d]+条|继续|还有呢|为什么|原因呢|具体呢|怎么理解)[？?]?$/.test(
      question.replace(/\s+/g, ''),
    );
  }

  private buildResult(
    intent: ReportQuestionIntent,
    confidence: ReportQuestionIntentResult['confidence'],
    source: ReportQuestionIntentResult['source'],
    searchQuery: string,
    referencedItemIndex?: number,
  ): ReportQuestionIntentResult {
    return {
      intent,
      confidence,
      recommendedTools: TOOL_ROUTES[intent],
      source,
      searchQuery: searchQuery.trim(),
      referencedItemIndex,
    };
  }

  private hasContextReference(question: string): boolean {
    return /这个|这句|那句|这一条|那一条|第[一二三四五六七八九十\d]+条/.test(
      question.replace(/\s+/g, ''),
    );
  }

  private parseReferencedItemIndex(question: string): number | undefined {
    const match: RegExpMatchArray | null = question
      .replace(/\s+/g, '')
      .match(/第([一二三四五六七八九十]|\d{1,2})条/);
    if (!match) {
      return undefined;
    }
    const chineseNumbers: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
    };
    const ordinal: number = chineseNumbers[match[1]] || Number(match[1]);
    return Number.isInteger(ordinal) && ordinal > 0 ? ordinal - 1 : undefined;
  }
}
