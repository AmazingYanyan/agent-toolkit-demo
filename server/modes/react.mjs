import { streamChat } from '../llm.mjs';
import { emitPromptBuilt, toolBrief, runToolWithEvents, newCallId } from './shared.mjs';

/**
 * 第十章：ReAct。
 *
 * 与第十二章之后的工具调用不同，这里**不使用原生 tools 参数**：
 * 模型靠文本协议输出 Thought / Action / Action Input，应用解析后再执行，
 * 把 Observation 拼回对话。这样「想—做—看」的循环在时间线上是完全可见的。
 *
 * 代价也很真实：文本协议会解析失败。失败就如实报出来，不静默兜底。
 */

const FENCE = /^```(?:text|markdown)?\s*|```$/gi;

export function parseReAct(text) {
  const cleaned = String(text || '').replace(FENCE, '').trim();
  const thought =
    /Thought:\s*([\s\S]*?)(?=\n\s*(?:Action|Final Answer|Observation):|$)/i.exec(cleaned)?.[1]?.trim() || '';
  const final = /Final Answer:\s*([\s\S]*)$/i.exec(cleaned)?.[1]?.trim() || '';
  const action = /^Action:\s*(.+)$/im.exec(cleaned)?.[1]?.trim() || '';
  const inputRaw = /Action Input:\s*([\s\S]*?)(?=\n\s*(?:Thought|Observation|Action|Final Answer):|$)/i.exec(cleaned)?.[1]?.trim() || '';

  let args = null;
  let argsError = null;
  if (action && inputRaw) {
    try {
      args = JSON.parse(inputRaw.replace(FENCE, '').trim());
    } catch (e) {
      argsError = e.message;
    }
  }

  return {
    cleaned,
    thought,
    final,
    action: action || null,
    inputRaw,
    args,
    argsError,
    ok: Boolean(final) || Boolean(action && args),
  };
}

function renderTrace(trace) {
  const lines = [];
  lines.push(`## 一、执行轨迹（${trace.length} 步）`);
  lines.push('');
  lines.push('| 步 | Action | Observation |');
  lines.push('| --- | --- | --- |');
  for (const t of trace) {
    const obs = String(t.observation || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 70);
    lines.push(`| ${t.step} | \`${t.action}\` | ${t.ok ? '✓' : '✗'} ${obs} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function runReAct({ config, cfg, question, messages, allDefs, skillCtxs, emit, signal, stats }) {
  const toolNames = allDefs.map((d) => d.function.name);
  const brief = toolBrief(allDefs);
  const maxSteps = Math.max(1, Math.min(8, Number(cfg.maxToolRounds || 6)));

  const system = [
    '你是一个按 ReAct 方式工作的执行器。每一步只能输出下面两种格式之一，不要输出别的内容。',
    '',
    '格式 A —— 还需要一个工具：',
    'Thought: <现在知道什么、还缺什么、为什么选这个工具>',
    'Action: <工具名>',
    'Action Input: <单行 JSON 对象>',
    '',
    '格式 B —— 信息已经足够：',
    'Thought: <判断依据>',
    'Final Answer: <给用户的完整回答>',
    '',
    '硬性规则：',
    `1. Action 必须严格来自工具清单：${toolNames.join('、') || '（本次没有工具）'}`,
    '2. Action Input 必须是合法 JSON，键名与工具参数一致。',
    '3. 一次只能有一个 Action；不要自己编造 Observation，那由应用填写。',
    '4. 不要用 Markdown 代码块包裹整个回复。',
    '5. 信息不足时继续调用工具；确实无法获得时，在 Final Answer 里说明缺什么。',
    '',
    '可用工具：',
    brief || '（本次没有提供任何工具）',
  ].join('\n');

  const convo = [...messages, { role: 'system', content: system }];

  emitPromptBuilt(emit, {
    config,
    cfg,
    messages: convo,
    tools: [],
    mode: 'react',
    extra: {
      toolNames,
      note: '注意：这次请求没有 tools 参数。工具是靠文本协议「说」出来的，不是 API 层的 function calling',
    },
  });

  const trace = [];
  let step = 0;
  let llmCalls = 0;
  let parseFailed = false;

  while (step < maxSteps) {
    step += 1;
    emit('react_step_started', 'react', {
      step,
      maxSteps,
      transcriptChars: convo.reduce((n, m) => n + String(m.content || '').length, 0),
      note: '每一步都是一次完整的模型调用，模型的「记忆」来自被拼回去的历史文本',
    });

    const res = await streamChat({
      config,
      messages: convo,
      temperature: cfg.temperature,
      signal,
      onDelta: (text) => emit('llm_output_delta', 'llm', { text, round: step }, 'streaming'),
    });
    llmCalls += 1;
    stats.llmCalls += 1;
    if (res.usage) {
      stats.promptTokens += res.usage.prompt_tokens || 0;
      stats.completionTokens += res.usage.completion_tokens || 0;
    }

    const parsed = parseReAct(res.content);

    emit('react_thought', 'react', {
      step,
      thought: parsed.thought || '（模型没有给出 Thought）',
      durationMs: res.durationMs,
      raw: parsed.cleaned.slice(0, 2000),
      note: 'Thought 是模型显式输出的文本，不是它的内部思维链；本平台只展示它写出来的部分',
    });

    if (parsed.final) {
      emit('react_final', 'react', {
        step,
        chars: parsed.final.length,
        note: '模型判断信息已足够，给出最终回答；循环在这里终止',
      });
      const answer = [renderTrace(trace), '## 二、最终回答', '', parsed.final].join('\n');
      return { answer, rounds: llmCalls, extra: { trace, parsed } };
    }

    if (!parsed.ok) {
      parseFailed = true;
      emit('react_parse_failed', 'react', {
        step,
        raw: parsed.cleaned.slice(0, 1500),
        reason: !parsed.action
          ? '既没有 Action 也没有 Final Answer'
          : parsed.argsError
            ? `Action Input 不是合法 JSON：${parsed.argsError}`
            : '格式不完整',
        note: '文本协议的真实代价：模型没按格式写，应用就解析不出来。这里不猜、不兜底，直接把原文摊开',
      }, 'error');
      // 给一次纠正机会：把错误原样回灌
      convo.push({ role: 'assistant', content: parsed.cleaned || '（空）' });
      convo.push({
        role: 'user',
        content:
          '你的上一条输出不符合格式要求（缺少可解析的 Action/Action Input，或 Action Input 不是合法 JSON）。' +
          '请严格按格式重新输出一次，只输出 Thought/Action/Action Input 或 Thought/Final Answer。',
      });
      continue;
    }

    if (!toolNames.includes(parsed.action)) {
      emit('react_action_invalid', 'react', {
        step,
        action: parsed.action,
        tools: toolNames,
        note: '模型请求了一个不存在的工具；应用拒绝执行，并把可用清单回灌给它',
      }, 'error');
      convo.push({ role: 'assistant', content: parsed.cleaned });
      convo.push({
        role: 'user',
        content: `工具 \`${parsed.action}\` 不存在。可用工具只有：${toolNames.join('、')}。请重新选择。`,
      });
      continue;
    }

    const callId = newCallId('react');
    emit('react_action', 'react', {
      step,
      action: parsed.action,
      args: parsed.args,
      callId,
      note: 'Action 与 Action Input 被解析成一次真实工具调用',
    });

    const r = await runToolWithEvents({
      emit,
      stats,
      callId,
      name: parsed.action,
      args: parsed.args || {},
      skillCtxs,
      sourceHint: 'react',
    });

    trace.push({
      step,
      action: parsed.action,
      args: parsed.args,
      ok: r.ok,
      observation: r.content || '',
      summary: r.summary,
    });

    const observation = r.ok ? r.content : `工具执行失败：${r.error}`;
    emit('react_observation', 'react', {
      step,
      ok: r.ok,
      chars: observation.length,
      observation: observation.slice(0, 2000),
      note: 'Observation 被原样拼回对话，成为模型下一步的输入——「看」的结果就是下一轮「想」的依据',
    }, r.ok ? 'ok' : 'error');

    convo.push({ role: 'assistant', content: parsed.cleaned });
    convo.push({ role: 'user', content: `Observation: ${observation}` });
  }

  emit('react_budget_exhausted', 'react', {
    step,
    maxSteps,
    parseFailed,
    note: '达到步数上限仍未收敛：如实停止，不把中间结果伪装成结论',
  }, 'error');

  const partial = [
    renderTrace(trace),
    '## 二、未能在预算内得出结论',
    '',
    `已执行 ${step} 步，达到上限 ${maxSteps}。下面是已获得的观测，未做进一步推断。`,
  ].join('\n');

  return { answer: partial, rounds: llmCalls, extra: { trace, budgetExhausted: true } };
}
