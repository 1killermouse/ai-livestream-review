import type { ReportChatMessage } from '@shared/api.interface';

import { ReportQuestionIntentRouter } from './report-question-intent.router';

describe('ReportQuestionIntentRouter', () => {
  const router = new ReportQuestionIntentRouter();

  it.each([
    ['哪一分钟有赚钱承诺？', 'risk_locate', 'inspect_risks'],
    ['这句话为什么属于收益承诺风险？', 'risk_explain', 'inspect_risks'],
    ['把这句风险话术改成能播的版本', 'rewrite', 'inspect_rewrite_suggestions'],
    ['课程承接环节的节奏合理吗？', 'rhythm', 'inspect_framework'],
    ['这场直播下一场先做什么？', 'summary_action', 'get_report_overview'],
  ])(
    'routes %s to %s',
    (question: string, expectedIntent: string, expectedTool: string) => {
      const result = router.classify(question);

      expect(result.intent).toBe(expectedIntent);
      expect(result.confidence).toBe('high');
      expect(result.recommendedTools[0]).toBe(expectedTool);
      expect(result.source).toBe('current_question');
    },
  );

  it('uses recent conversation context for a short follow-up', () => {
    const messages: ReportChatMessage[] = [
      { role: 'user', content: '哪一句收益承诺风险最大？' },
      { role: 'assistant', content: '00:12 附近需要优先处理。' },
    ];

    const result = router.classify('为什么？', messages);

    expect(result).toMatchObject({
      intent: 'risk_explain',
      confidence: 'medium',
      source: 'conversation_context',
    });
    expect(result.searchQuery).toContain('收益承诺风险');
  });

  it('resolves an ordinal rewrite follow-up without another model call', () => {
    const messages: ReportChatMessage[] = [
      { role: 'user', content: '这场最该先改哪三处？' },
      { role: 'assistant', content: '第一条收益承诺，第二条案例夸大。' },
    ];

    const result = router.classify('第二条怎么改？', messages);

    expect(result).toMatchObject({
      intent: 'rewrite',
      source: 'conversation_context',
      referencedItemIndex: 1,
    });
    expect(result.searchQuery).toContain('最该先改哪三处');
  });

  it('keeps unclear questions open for the ReAct agent', () => {
    const result = router.classify('你怎么看？');

    expect(result).toMatchObject({
      intent: 'unknown',
      confidence: 'low',
      source: 'fallback',
    });
  });
});
