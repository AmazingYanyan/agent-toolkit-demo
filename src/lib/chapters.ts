import type { Chapter, RunConfig } from './types';

export const BASE_CONFIG: RunConfig = {
  chapter: 'ch01',
  chapterTitle: '',
  systemPrompt: {
    enabled: false,
    text: '你是一名财务风险分析助手。请先列出已确认的事实，再说明风险迹象，最后说明当前证据不足之处。不得编造未被提供的财务数据，不得给出授信审批结论。',
  },
  multiTurn: false,
  temperature: 0.2,
  functionCalling: false,
  tools: [],
  mcpMode: false,
  rag: false,
  ragMode: 'hybrid',
  topK: 4,
  skill: null,
  skillAuto: false,
  skillRefs: true,
  skillScripts: true,
  maxToolRounds: 4,
};

/**
 * 页面只承载「可操作的东西」：章节标题、演示问题、能力预设。
 * 一句话主旨、教学目标、观察重点、操作顺序、概念解释全部放在 docs/教学要点.md，
 * 演示界面与讲解材料解耦，避免屏幕上出现讲稿。
 */
export const CHAPTERS: Chapter[] = [
  {
    id: 'ch01',
    no: '01',
    title: '什么是 LLM',
    question: '请分析一家营业收入下降 20%、经营活动现金流为负的企业可能存在什么风险。',
    preset: {},
  },
  {
    id: 'ch02',
    no: '02',
    title: 'Prompt 与 System Prompt',
    question:
      '请用以下三个指标分析企业风险：2024 年营业收入 1000 万元，2025 年营业收入 800 万元，2025 年经营活动现金流量净额为 -100 万元。',
    preset: {},
  },
  {
    id: 'ch03',
    no: '03',
    title: '上下文与多轮对话',
    question: '某企业 2024 年营业收入 1000 万元，2025 年营业收入 800 万元。',
    placeholder: '第二轮追问：那它的收入下降了多少？',
    preset: {},
  },
  {
    id: 'ch04',
    no: '04',
    title: 'Function Calling 工具调用',
    question: '请查询演示企业A（星河科技，DEMO001）的注册资本和登记状态。',
    preset: { functionCalling: false, tools: [] },
  },
  {
    id: 'ch05',
    no: '05',
    title: 'API 与 MCP',
    question: '请查询宁德时代新能源科技股份有限公司的工商登记信息：注册资本、登记状态、法定代表人。',
    preset: {
      functionCalling: true,
      mcpMode: true,
      tools: ['tyc__search_companies', 'tyc__get_company_basic_profile'],
    },
  },
  {
    id: 'ch06',
    no: '06',
    title: 'RAG 与外部知识库',
    question: '怎么判断一家公司还不还得起债？请按知识库里的口径回答。',
    preset: { rag: true, ragMode: 'hybrid', topK: 4 },
  },
  {
    id: 'ch07',
    no: '07',
    title: 'Skill 与专家经验',
    question:
      '根据以下数据分析企业风险：2024 年营业收入 1000 万元，2025 年营业收入 800 万元；2025 年总资产 1000 万元、总负债 750 万元；2025 年经营活动现金流量净额 -100 万元。',
    preset: {
      skill: 'financial-risk',
      skillAuto: false,
      functionCalling: true,
      tools: [],
      skillRefs: true,
      skillScripts: true,
    },
  },
  {
    id: 'ch08',
    no: '08',
    title: '结构化输出与确定性规则',
    question: '待开放',
    preset: {},
    locked: true,
  },
  {
    id: 'ch09',
    no: '09',
    title: '什么是 Agent',
    question: '待开放',
    preset: {},
    locked: true,
  },
  {
    id: 'ch10',
    no: '10',
    title: 'ReAct 运行模式',
    question: '待开放',
    preset: {},
    locked: true,
  },
  {
    id: 'ch11',
    no: '11',
    title: 'Plan-and-Execute',
    question: '待开放',
    preset: {},
    locked: true,
  },
  {
    id: 'ch12',
    no: '12',
    title: 'Harness 运行保障',
    question: '待开放',
    preset: {},
    locked: true,
  },
  {
    id: 'ch13',
    no: '13',
    title: '权限、人工确认与安全边界',
    question: '待开放',
    preset: {},
    locked: true,
  },
  {
    id: 'ch14',
    no: '14',
    title: '多 Agent 与业务编排',
    question: '待开放',
    preset: {},
    locked: true,
  },
];

export function getChapter(id: string): Chapter {
  return CHAPTERS.find((c) => c.id === id) || CHAPTERS[0];
}

export function chapterConfig(ch: Chapter): RunConfig {
  return {
    ...BASE_CONFIG,
    ...ch.preset,
    chapter: ch.id,
    chapterTitle: ch.title,
    systemPrompt: { ...BASE_CONFIG.systemPrompt, ...(ch.preset.systemPrompt || {}) },
  };
}
