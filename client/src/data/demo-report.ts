import type {
  PrototypeAnalysisReport,
  PrototypeAnalysisRequest,
} from '@shared/api.interface';

const DEFAULT_FRAMEWORK_NAME = 'AI 知识付费直播全场转化框架';

export function buildDemoReport(
  request: PrototypeAnalysisRequest,
): PrototypeAnalysisReport {
  const frameworkName = request.frameworkName?.trim() || DEFAULT_FRAMEWORK_NAME;

  return {
    id: `local-demo-${Date.now()}`,
    title:
      request.inputSource === 'live_url'
        ? 'AI 知识付费直播链接话术诊断报告'
        : request.recordingName || 'AI 知识付费录屏话术诊断报告',
    inputSource: request.inputSource,
    durationSeconds: 326,
    transcriptWordCount: 159,
    frameworkName,
    summary: {
      totalFindings: 4,
      highRiskFindings: 3,
      rewriteSuggestions: 4,
      overallDiagnosis:
        '本场话术按 AI 知识付费全场框架诊断：前 60 分钟要集中输出干货建立价值感，60-84 分钟承接课程和权益，84-90 分钟用案例继续立人设，后续再做成交承接，同时收敛 AI 变现承诺和过度逼单。',
    },
    transcriptSegments: [
      {
        id: 'asr-1',
        startSeconds: 0,
        endSeconds: 58,
        text: '如果你是0基础小白，想用AI做副业，今天这场直播先听懂适不适合你，不适合的人我也会直接告诉你。',
        wordCount: 42,
        matchedStage: '目标人群',
      },
      {
        id: 'asr-2',
        startSeconds: 58,
        endSeconds: 136,
        text: '很多人不是不会努力，是不会写提示词，不知道怎么把AI用到短视频、文案和获客里。',
        wordCount: 34,
        matchedStage: 'AI 痛点',
      },
      {
        id: 'asr-3',
        startSeconds: 136,
        endSeconds: 224,
        text: '我们的训练营会给你SOP、提示词模板、案例拆解和作业点评，但我不能保证每个人都能变现。',
        wordCount: 37,
        matchedStage: '方法路径',
      },
      {
        id: 'asr-4',
        startSeconds: 224,
        endSeconds: 326,
        text: '跟着我这套训练营做，可以一键生成爆款内容，保证你一个月用AI变现，0基础小白七天就能接单回本。',
        wordCount: 46,
        matchedStage: '案例边界/成交承接',
      },
    ],
    findings: [
      {
        id: 'finding-1',
        type: 'semantic_risk',
        riskLevel: 'high',
        startSeconds: 224,
        originalText: '保证你一个月用AI变现',
        matchedRule: 'AI 变现或学习结果承诺过强',
        analysis:
          '这句话把 AI 学习结果和变现结果说成确定收益，容易形成收益承诺。',
        suggestion: '改成学习目标、适用条件和执行前提，避免保证型表达。',
        replacementScript:
          '这套课会带你拆 AI 工具、提示词和落地流程，适合愿意持续练习的人，具体结果和个人基础、投入时间、执行情况有关。',
      },
      {
        id: 'finding-2',
        type: 'semantic_risk',
        riskLevel: 'high',
        startSeconds: 224,
        originalText: '0基础小白七天接单回本',
        matchedRule: 'AI 副业案例夸大收益风险',
        analysis: '低门槛人群加短周期收益，容易让用户理解为普遍可复制。',
        suggestion: '案例必须说明背景、投入和不可保证复制。',
        replacementScript:
          '我们会拆案例里的工具选择、交付动作和练习路径，但案例结果不代表每个人都能复制。',
      },
      {
        id: 'finding-3',
        type: 'semantic_risk',
        riskLevel: 'high',
        startSeconds: 224,
        originalText: '一键生成爆款内容',
        matchedRule: 'AI 工具能力夸大',
        analysis:
          '把 AI 工具包装成一键赚钱，会夸大工具能力，也会误导用户对课程的预期。',
        suggestion: '强调 AI 是提效工具，仍需要人工判断、修改和持续交付。',
        replacementScript:
          'AI 能提高内容生产效率，但选题判断、内容修改和最终交付仍然需要人来完成。',
      },
      {
        id: 'finding-4',
        type: 'semantic_risk',
        riskLevel: 'medium',
        startSeconds: 0,
        originalText: '想用AI做副业',
        matchedRule: 'AI 副业收益暗示边界',
        analysis:
          '把 AI 和副业结果直接放在一起，可能让用户把课程理解成轻松赚钱的捷径。',
        suggestion:
          '先讲清楚具体应用场景、适用人群和学习投入，不暗示稳定收益。',
        replacementScript:
          '如果你想了解 AI 怎么提升内容和工作效率，今天先跟着我做一个简单案例，再判断这套方法适不适合你。',
      },
    ],
    frameworkMatches: [
      {
        stageName: '集中输出 AI 干货',
        status: 'matched',
        expectedWindow: '0-60 分钟',
        actualStartSeconds: 0,
        actualEndSeconds: 224,
        evidenceSegmentIds: ['asr-1', 'asr-2', 'asr-3'],
        timingIssue: 'on_track',
        confidence: 'high',
        evidence: '样例中包含 AI 工具、提示词和实操路径内容。',
        suggestion: '继续保持干货密度，让用户先感知价值，再承接课程。',
      },
      {
        stageName: '课程承接与权益说明',
        status: 'not_applicable',
        expectedWindow: '60-84 分钟',
        evidenceSegmentIds: [],
        timingIssue: 'not_applicable',
        confidence: 'high',
        evidence: '样例片段时长不足 60 分钟，暂不强判课程承接缺失。',
        suggestion: '60 分钟后再集中讲课程交付、权益、服务周期和报名路径。',
      },
      {
        stageName: '成功案例与人设强化',
        status: 'not_applicable',
        expectedWindow: '84-90 分钟',
        evidenceSegmentIds: [],
        timingIssue: 'not_applicable',
        confidence: 'high',
        evidence: '样例片段尚未进入 84-90 分钟窗口，暂不强判案例人设缺失。',
        suggestion: '案例要继续立人设，但必须说明背景、投入和不可保证复制。',
      },
      {
        stageName: '持续成交承接',
        status: 'not_applicable',
        expectedWindow: '90 分钟后',
        evidenceSegmentIds: [],
        timingIssue: 'not_applicable',
        confidence: 'high',
        evidence: '样例片段尚未进入 90 分钟后的成交承接窗口，暂不强判。',
        suggestion:
          '后续可以持续成交承接，但要控制过度逼单、虚假稀缺和站外交易风险。',
      },
    ],
    reviewScript:
      '前面继续保留 AI 工具和提示词案例，让用户先听懂方法价值。讲到课程时，把训练内容、作业反馈和适合人群说清楚，不要承诺确定收益。涉及工具效果时可以直接说：“AI 能提高内容生产效率，但选题判断、内容修改和最终交付仍然需要人来完成。”',
    ragReferences: [
      {
        id: 'framework-0-60-value-anxiety-demo',
        type: 'framework',
        title: '0-60 分钟：焦虑唤醒 + AI 干货案例',
        excerpt:
          '前 60 分钟先让用户感受直播间价值，适度唤醒 AI 效率焦虑，再手把手完成一个简单案例。',
        score: 12,
      },
      {
        id: 'risk-ai-case-boundary',
        type: 'risk_rule',
        title: '案例结果边界',
        excerpt:
          '案例需要补充学员基础、执行动作、投入时间和不可保证复制的边界。',
        score: 8,
      },
      {
        id: 'framework-60-84-course-offer',
        type: 'framework',
        title: '60-84 分钟：课程承接 + 权益说明 + 抛价格',
        excerpt:
          '从免费案例承接到系统课程，讲清交付、答疑、陪跑、作业点评和工具包。',
        score: 5,
      },
    ],
    agentTrace: [
      {
        nodeName: '转写整理 Agent',
        status: 'completed',
        output: '读取样例 ASR 文本 4 段，保留时间戳和字数。',
      },
      {
        nodeName: '框架检索 Agent',
        status: 'completed',
        output:
          '检索 AI 知识付费直播全场框架，按 0-60 干货、60-84 课程权益、84-90 案例人设、90 分钟后成交承接判断。',
      },
      {
        nodeName: '节奏诊断 ReAct Agent',
        status: 'completed',
        output: '结合框架时间窗和逐字稿证据，判断阶段覆盖与实际节奏。',
      },
      {
        nodeName: '风险判断 Agent',
        status: 'completed',
        output: '识别 4 个样例风险点，覆盖违禁词、语义风险和框架缺口。',
      },
      {
        nodeName: '整改话术 ReAct Agent',
        status: 'completed',
        output: '结合风险和节奏生成 4 条可替换话术及整段复盘改稿。',
      },
    ],
  };
}
