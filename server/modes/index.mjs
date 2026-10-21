import { runStructured } from './structured.mjs';
import { runPlanExecute } from './plan.mjs';
import { runReAct } from './react.mjs';
import { runGoalLoop } from './goal.mjs';

/**
 * 08–11 章的四条控制流。
 *
 * 共同点：都在同一个运行引擎里，共用消息构建、工具执行与事件协议。
 * 不同点只在「谁决定下一步」：
 *   structured  没有下一步，只有一次结构化抽取 + 程序判定
 *   agent       模型自己判断「还缺什么」，逐轮决策直到 done
 *   react       模型用文本协议说出 Thought/Action，应用执行后回灌 Observation
 *   plan        先产出一份计划，再按计划执行，失败时修订计划
 */

export const AGENT_MODES = ['structured', 'agent', 'react', 'plan'];

export const MODE_LABELS = {
  structured: '结构化输出',
  agent: '目标循环',
  react: 'ReAct',
  plan: 'Plan-and-Execute',
};

export function isAgentMode(mode) {
  return AGENT_MODES.includes(mode);
}

export async function runAgentMode(args) {
  switch (args.mode) {
    case 'structured':
      return runStructured(args);
    case 'plan':
      return runPlanExecute(args);
    case 'react':
      return runReAct(args);
    case 'agent':
      return runGoalLoop(args);
    default:
      throw new Error(`未知运行模式：${args.mode}`);
  }
}

/** 只保留可复述的摘要，避免把整段轨迹写进运行记录 */
export function summarizeExtra(mode, extra) {
  if (!extra) return null;
  if (mode === 'structured') {
    return {
      schemaOk: extra.schemaErrors ? extra.schemaErrors.length === 0 : Boolean(extra.structured),
      triggeredCount: extra.rules?.triggeredCount ?? null,
      verdict: extra.rules?.verdict || null,
    };
  }
  if (mode === 'plan') {
    return {
      goal: extra.plan?.goal || null,
      stepCount: extra.plan?.steps?.length || 0,
      executed: (extra.executed || []).map((e) => ({ id: e.id, tool: e.tool, ok: e.ok, summary: e.summary })),
      revised: Boolean(extra.revision),
    };
  }
  if (mode === 'react') {
    return {
      steps: (extra.trace || []).map((t) => ({ step: t.step, action: t.action, ok: t.ok })),
      budgetExhausted: Boolean(extra.budgetExhausted),
    };
  }
  if (mode === 'agent') {
    return {
      done: Boolean(extra.done),
      steps: (extra.steps || []).map((s) => ({
        step: s.step,
        tool: s.action?.tool || null,
        ok: s.ok,
        assessment: s.assessment,
      })),
    };
  }
  return null;
}
