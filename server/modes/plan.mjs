import { streamChat } from '../llm.mjs';
import {
  emitPromptBuilt,
  jsonCall,
  schemaToPrompt,
  toolBrief,
  runToolWithEvents,
  newCallId,
} from './shared.mjs';
import {
  PLAN_SCHEMA,
  PLAN_REVISE_SCHEMA,
  validateAgainstSchema,
  errorsToHint,
} from './schema.mjs';

/**
 * 第十一章：Plan-and-Execute。
 *
 * 与 ReAct 的根本区别：先把整条链路想清楚，产出一份可审阅的计划，再逐步执行。
 * 计划是**一次性产物**，执行阶段不再重新决定「下一步做什么」，只在失败时修订。
 *
 * 三个阶段：
 *   1) 规划：模型输出结构化计划（目标 / 理由 / 步骤 / 每步工具与参数）
 *   2) 执行：应用逐条执行，把观测结果累积起来；某步失败则允许一次重规划
 *   3) 汇总：把计划与观测一起交给模型写结论，同时渲染一张可核对的执行表
 */

const fmtArgs = (args) => {
  const s = JSON.stringify(args || {});
  return s.length > 90 ? s.slice(0, 88) + '…' : s;
};

/** 按点号路径取值，支持数组下标：financials.1.total_liabilities */
function getByPath(obj, path) {
  return String(path)
    .split('.')
    .reduce((acc, key) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) {
        const i = Number(key);
        return Number.isInteger(i) ? acc[i] : undefined;
      }
      return acc[key];
    }, obj);
}

/**
 * 深度按字段名查找：计划阶段写不出数组下标时，可以只写字段名。
 * 命中多条时的取舍规则是确定的：优先年份最大的那一条，否则取最后一条，并在事件里写明取了哪个。
 */
function deepFind(node, key, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) deepFind(item, key, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === key && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) {
        out.push({ value: v, year: typeof node.year === 'number' ? node.year : null });
      } else {
        deepFind(v, key, out);
      }
    }
  }
  return out;
}

function pickMatch(matches) {
  if (!matches.length) return null;
  if (matches.length === 1) return { ...matches[0], picks: 1, rule: '唯一匹配' };
  const withYear = matches.filter((m) => typeof m.year === 'number');
  if (withYear.length) {
    const maxYear = Math.max(...withYear.map((m) => m.year));
    const picked = matches.filter((m) => m.year === maxYear).slice(-1)[0];
    return { ...picked, picks: matches.length, rule: `命中 ${matches.length} 条，取年份最大（${maxYear}）的一条` };
  }
  return { ...matches[matches.length - 1], picks: matches.length, rule: `命中 ${matches.length} 条，取最后一条` };
}

/**
 * 解析参数里的占位符：`$2.total_liabilities`、`$2.financials.1.total_assets`
 * 或 `{{step2.total_assets}}`。
 *
 * 这是 Plan-and-Execute 的关键一环：计划阶段只知道结构，不知道值；
 * 值要等前一步真的执行完才能绑定。绑不上就如实失败，不塞一个默认值糊过去。
 */
function resolveArgs(args, executed, used, unresolved) {
  const walk = (v) => {
    if (typeof v === 'string') {
      const m = /^\$(\d+)\.(.+)$/.exec(v.trim()) || /^\{\{\s*step(\d+)\.(.+?)\s*\}\}$/.exec(v.trim());
      if (!m) return v;
      const stepId = Number(m[1]);
      const path = m[2];
      const src = executed.find((e) => e.id === stepId) || executed[stepId - 1];
      if (!src || !src.data) {
        unresolved.push({ from: v, reason: `步骤 ${stepId} 没有可用的返回结果` });
        return v;
      }
      const exact = getByPath(src.data, path);
      if (exact !== undefined) {
        used.push({ from: v, path: `step${stepId}.${path}`, value: exact, rule: '按路径精确取值' });
        return exact;
      }
      const key = path.split('.').pop();
      const picked = pickMatch(deepFind(src.data, key));
      if (!picked) {
        unresolved.push({ from: v, reason: `步骤 ${stepId} 的返回结果里找不到字段 ${key}` });
        return v;
      }
      used.push({ from: v, path: `step${stepId}.${key}`, value: picked.value, rule: picked.rule });
      return picked.value;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(args);
}

function renderPlanTable(executed, revision) {
  const lines = [];
  lines.push(`## 一、执行计划（规划器产出，共 ${executed.length} 步）`);
  lines.push('');
  lines.push('| # | 步骤 | 工具 | 结果 |');
  lines.push('| --- | --- | --- | --- |');
  for (const e of executed) {
    const mark = e.ok ? '✓' : '✗';
    const brief = String(e.summary || '').replace(/\|/g, '/').slice(0, 60);
    lines.push(`| ${e.id} | ${e.title} | \`${e.tool}\` | ${mark} ${brief} |`);
  }
  lines.push('');
  if (revision) {
    lines.push(`> 执行中修订过一次计划：${revision.reason}`);
    lines.push('');
  }
  return lines.join('\n');
}

export async function runPlanExecute({
  config,
  cfg,
  question,
  messages,
  allDefs,
  skillCtxs,
  emit,
  signal,
  stats,
}) {
  const toolNames = allDefs.map((d) => d.function.name);
  const brief = toolBrief(allDefs);
  const maxSteps = Math.max(1, Math.min(8, Number(cfg.maxToolRounds || 6)));

  // ---------------- 阶段一：规划 ----------------
  const plannerSystem = [
    '你是一个任务规划器，只负责「想清楚怎么做」，不负责执行。',
    '',
    '可用工具：',
    brief || '（本次没有提供任何工具）',
    '',
    '规划要求：',
    '1. 用最少步骤达成用户目标，一般 2–4 步；每步只调用一个工具。',
    '2. tool 必须严格来自上面列出的工具名，不得自创。',
    '3. args 必须符合该工具的参数定义；不确定的参数不要编造。',
    '4. 如果某一步的参数需要用到前面步骤的执行结果，用占位符：`"$步骤号.字段名"`，',
    '   例如 `"numerator": "$2.total_liabilities"`、`"denominator": "$2.total_assets"`。',
    '   执行器会在执行该步之前，去第 2 步的返回结果里按字段名取值；也可以写完整路径如 `$2.financials.0.total_assets`。',
    '   计划阶段不知道具体数值，**不要凭空编造数字**，也不要把字段名当数字传。',
    '5. 如果目标不需要任何工具，也要给出一步「直接回答」，tool 填 `__answer__`。',
    '6. 只输出 JSON，不要解释，不要 Markdown 代码块。',
    '',
    schemaToPrompt(PLAN_SCHEMA),
  ].join('\n');

  const plannerMessages = [...messages, { role: 'system', content: plannerSystem }];

  emitPromptBuilt(emit, {
    config,
    cfg,
    messages: plannerMessages,
    tools: [],
    responseFormat: { type: 'json_schema', json_schema: { name: PLAN_SCHEMA.name, strict: true, schema: PLAN_SCHEMA.schema } },
    mode: 'plan',
    extra: { phase: 'plan', toolNames, note: '第一阶段：只出计划，不执行任何工具' },
  });

  emit('plan_requested', 'planner', {
    goal: question,
    tools: toolNames,
    toolCount: toolNames.length,
    maxSteps,
    schemaName: PLAN_SCHEMA.name,
    schemaChars: JSON.stringify(PLAN_SCHEMA.schema).length,
    note: '规划器拿到的是工具清单与目标，它这一步不允许调用工具，只能输出计划',
  });

  let llmCalls = 0;
  let planCall = await jsonCall({
    config,
    messages: plannerMessages,
    schema: PLAN_SCHEMA,
    temperature: 0,
    signal,
    emit,
    label: 'plan',
    round: 1,
  });
  llmCalls += 1;
  stats.llmCalls += 1;
  if (planCall.usage) {
    stats.promptTokens += planCall.usage.prompt_tokens || 0;
    stats.completionTokens += planCall.usage.completion_tokens || 0;
  }

  let plan = planCall.json;
  let planErrors = plan ? validateAgainstSchema(plan, PLAN_SCHEMA.schema) : [`计划不是合法 JSON：${planCall.parseError}`];

  if (!planErrors.length) {
    // 工具名与参数必须真实存在，否则计划无法执行
    const unknown = (plan.steps || []).filter((s) => s.tool !== '__answer__' && !toolNames.includes(s.tool));
    if (unknown.length) {
      planErrors.push(
        ...unknown.map((s) => `$steps: 工具 \`${s.tool}\` 不在本次可用清单中（可用：${toolNames.join('、') || '无'}）`)
      );
    }
  }

  emit('plan_validated', 'planner', {
    ok: planErrors.length === 0,
    errors: planErrors,
    note:
      planErrors.length === 0
        ? '计划结构合法，且每个步骤引用的工具都在可用清单里'
        : '计划有问题：这一层校验能挡住「模型编一个不存在的工具」这种最常见的失败',
  });

  if (planErrors.length) {
    emit('plan_repair_requested', 'planner', { errors: planErrors, hint: errorsToHint(planErrors) });
    const repair = await jsonCall({
      config,
      messages: [
        ...plannerMessages,
        { role: 'assistant', content: planCall.raw || '（空）' },
        {
          role: 'user',
          content: `上面的计划不合法：\n${errorsToHint(planErrors)}\n请只输出修正后的 JSON 计划。`,
        },
      ],
      schema: PLAN_SCHEMA,
      temperature: 0,
      signal,
      emit,
      label: 'plan_repair',
      round: 2,
    });
    llmCalls += 1;
    stats.llmCalls += 1;
    if (repair.usage) {
      stats.promptTokens += repair.usage.prompt_tokens || 0;
      stats.completionTokens += repair.usage.completion_tokens || 0;
    }
    plan = repair.json;
    planErrors = plan ? validateAgainstSchema(plan, PLAN_SCHEMA.schema) : [`修复后仍不是合法 JSON：${repair.parseError}`];
  }

  if (!plan || planErrors.length) {
    emit('plan_failed', 'planner', { errors: planErrors, note: '两次都没有得到可执行的计划，直接停止，不假装执行过' }, 'error');
    return {
      answer:
        '## 计划生成失败\n\n规划器两次都没有给出可执行的结构化计划，任务已停止，没有执行任何工具。\n\n' +
        planErrors.map((e) => `- ${e}`).join('\n'),
      rounds: llmCalls,
      extra: { plan: null, executed: [] },
    };
  }

  emit('plan_created', 'planner', {
    goal: plan.goal,
    reasoning: plan.reasoning,
    steps: plan.steps,
    stepCount: plan.steps.length,
    planChars: JSON.stringify(plan).length,
    raw: planCall.raw.slice(0, 3000),
    note: '计划是这一步的产物，也是一个可审阅的对象：能贴到评审会上讨论，也能存档',
  });

  // ---------------- 阶段二：执行 ----------------
  const queue = [...plan.steps];
  const executed = [];
  let revision = null;
  let revisedOnce = false;
  let index = 0;

  while (index < queue.length && executed.length < maxSteps) {
    const step = queue[index];
    const callId = newCallId('plan');

    emit('plan_step_started', 'executor', {
      stepId: step.id,
      index: index + 1,
      total: queue.length,
      title: step.title,
      tool: step.tool,
      args: step.args,
      expect: step.expect,
      note: '执行阶段不再重新规划：确定好的步骤直接交给工具，模型不参与执行决策',
    });

    if (step.tool === '__answer__') {
      executed.push({ ...step, ok: true, summary: '无需工具，直接回答', observation: '' });
      emit('plan_step_completed', 'executor', {
        stepId: step.id,
        ok: true,
        summary: '跳过：该步声明无需工具',
      });
      index += 1;
      continue;
    }

    const used = [];
    const unresolved = [];
    const resolvedArgs = resolveArgs(step.args || {}, executed, used, unresolved);
    if (used.length || unresolved.length) {
      emit('plan_step_args_resolved', 'executor', {
        stepId: step.id,
        original: step.args,
        resolved: resolvedArgs,
        refs: used,
        unresolved,
        note: unresolved.length
          ? '有引用没绑上：这一步不会真的执行，避免把占位符当参数传给工具，再伪装成「工具失败」'
          : '计划里写的是占位符，执行前才绑定成真实数值：计划阶段不可能知道还没查到的数',
      }, unresolved.length ? 'error' : 'ok');
    }

    const r = unresolved.length
      ? {
          ok: false,
          content: JSON.stringify({ error: '参数引用未能解析', unresolved }),
          summary: `参数引用未解析：${unresolved.map((u) => u.from).join('、')}`,
          error: `参数引用未能解析：${unresolved.map((u) => u.reason).join('；')}`,
          data: null,
        }
      : await runToolWithEvents({
          emit,
          stats,
          callId,
          name: step.tool,
          args: resolvedArgs,
          skillCtxs,
          sourceHint: 'plan',
        });

    executed.push({
      id: step.id,
      title: step.title,
      tool: step.tool,
      ok: r.ok,
      summary: r.summary,
      observation: (r.content || '').slice(0, 1500),
      data: r.data,
    });

    emit('plan_step_completed', 'executor', {
      stepId: step.id,
      ok: r.ok,
      summary: r.summary,
      observation: (r.content || '').slice(0, 1500),
      error: r.ok ? null : r.error,
      note: r.ok ? '这一步的观测结果会累积给后面的步骤与最终汇总' : '这一步失败，触发一次重规划',
    }, r.ok ? 'ok' : 'error');

    if (!r.ok && !revisedOnce) {
      revisedOnce = true;
      emit('plan_replan_requested', 'planner', {
        failedStep: step,
        error: r.error,
        note: '失败是真实发生的；重规划只允许一次，避免无限重试',
      });
      const rev = await jsonCall({
        config,
        messages: [
          ...plannerMessages,
          { role: 'assistant', content: planCall.raw },
          {
            role: 'user',
            content:
              `执行到第 ${index + 1} 步「${step.title}」时失败：${r.error}\n` +
              `已完成步骤：${executed.map((e) => `${e.id}.${e.title}`).join('；') || '无'}\n` +
              '请给出**剩余步骤**的修订计划（不要重复已完成的步骤）。只输出 JSON。',
          },
        ],
        schema: PLAN_REVISE_SCHEMA,
        temperature: 0,
        signal,
        emit,
        label: 'replan',
        round: 3,
      });
      llmCalls += 1;
      stats.llmCalls += 1;
      if (rev.usage) {
        stats.promptTokens += rev.usage.prompt_tokens || 0;
        stats.completionTokens += rev.usage.completion_tokens || 0;
      }

      const revErrors = rev.json
        ? validateAgainstSchema(rev.json, PLAN_REVISE_SCHEMA.schema)
        : [`重规划不是合法 JSON：${rev.parseError}`];

      if (!revErrors.length && (rev.json.revised_steps || []).length) {
        revision = { reason: rev.json.reason, steps: rev.json.revised_steps };
        queue.splice(index + 1, queue.length - index - 1, ...rev.json.revised_steps);
        emit('plan_revised', 'planner', {
          reason: rev.json.reason,
          revised_steps: rev.json.revised_steps,
          remaining: queue.length - index - 1,
          note: '计划被改写了：这就是 Plan-and-Execute 的可控之处——改的是计划本身，而不是模型脑子里的想法',
        });
      } else {
        emit('plan_revision_failed', 'planner', { errors: revErrors }, 'error');
      }
    }

    index += 1;
  }

  if (executed.length >= maxSteps && index < queue.length) {
    emit('plan_budget_exhausted', 'executor', {
      executed: executed.length,
      remaining: queue.length - index,
      maxSteps,
      note: '达到步数上限，剩余步骤不再执行。宁可停下来说明，也不假装跑完',
    }, 'error');
  }

  // ---------------- 阶段三：汇总 ----------------
  const observationText = executed
    .map((e, i) => {
      const head = `[第 ${i + 1} 步] ${e.title}（${e.tool}）→ ${e.ok ? '成功' : '失败'}`;
      return `${head}\n${e.observation || e.summary || '（无输出）'}`;
    })
    .join('\n\n');

  const synthesisMessages = [
    ...messages,
    {
      role: 'system',
      content:
        '下面是一次已经执行完的计划与每步的观测结果。请只依据这些观测写结论：' +
        '说明查到了什么、哪些步骤失败或缺失、还缺什么数据。不要编造观测里没有的事实，不要给授信审批结论。',
    },
    { role: 'user', content: `计划目标：${plan.goal}\n\n执行记录：\n${observationText || '（没有执行任何步骤）'}` },
  ];

  emitPromptBuilt(emit, {
    config,
    cfg,
    messages: synthesisMessages,
    tools: [],
    mode: 'plan',
    extra: { phase: 'synthesis', note: '第三阶段：不带工具，只让模型对着观测写结论' },
  });

  emit('plan_synthesis_started', 'llm', {
    observations: executed.length,
    observationChars: observationText.length,
    note: '汇总阶段的模型没有工具可用，只能引用上面这些观测',
  });

  const synth = await streamChat({
    config,
    messages: synthesisMessages,
    temperature: cfg.temperature,
    signal,
    onDelta: (text) => emit('llm_output_delta', 'llm', { text, round: 'synthesis' }, 'streaming'),
  });
  llmCalls += 1;
  stats.llmCalls += 1;
  if (synth.usage) {
    stats.promptTokens += synth.usage.prompt_tokens || 0;
    stats.completionTokens += synth.usage.completion_tokens || 0;
  }

  emit('plan_synthesis_completed', 'llm', {
    chars: (synth.content || '').length,
    durationMs: synth.durationMs,
    usage: synth.usage,
  });

  emit('plan_completed', 'executor', {
    executed: executed.length,
    okCount: executed.filter((e) => e.ok).length,
    failedCount: executed.filter((e) => !e.ok).length,
    revised: Boolean(revision),
    note: '计划执行结束；下面的回答由「执行表 + 观测结论」两部分组成',
  });

  const answer = [renderPlanTable(executed, revision), '## 二、结论', '', (synth.content || '').trim()]
    .join('\n')
    .replace(/## 一、执行计划/, '## 一、执行计划');

  return {
    answer,
    rounds: llmCalls,
    extra: { plan, executed, revision },
  };
}
