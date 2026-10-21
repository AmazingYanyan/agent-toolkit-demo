import {
  emitPromptBuilt,
  jsonCall,
  schemaToPrompt,
  toolBrief,
  runToolWithEvents,
  newCallId,
} from './shared.mjs';
import { AGENT_STEP_SCHEMA, validateAgainstSchema, errorsToHint } from './schema.mjs';

/**
 * 第九章：什么是 Agent —— 目标驱动的循环。
 *
 * 与前面章节最本质的区别：**没有人告诉它下一步做什么**。
 * 目标给进去，它自己判断「还缺什么 → 调哪个工具 → 拿到了没有 → 要不要停」。
 * 循环必须有三个东西才成立：目标、可执行的工具、明确的终止条件。
 */

function renderSteps(steps) {
  const lines = [];
  lines.push(`## 一、Agent 执行过程（${steps.length} 步）`);
  lines.push('');
  for (const s of steps) {
    lines.push(`**第 ${s.step} 步**　${s.assessment || '—'}`);
    if (s.action) {
      lines.push(`- 决定：调用 \`${s.action.tool}\`（${s.action.why || '未说明理由'}）`);
      lines.push(`- 参数：\`${JSON.stringify(s.action.args || {})}\``);
      lines.push(`- 观测：${s.ok ? '成功' : '失败'} · ${String(s.summary || '').slice(0, 120)}`);
    } else {
      lines.push('- 决定：不再调用工具');
    }
    lines.push('');
  }
  return lines.join('\n');
}

export async function runGoalLoop({ config, cfg, question, messages, allDefs, skillCtxs, emit, signal, stats }) {
  const toolNames = allDefs.map((d) => d.function.name);
  const brief = toolBrief(allDefs);
  const maxSteps = Math.max(1, Math.min(8, Number(cfg.maxToolRounds || 4)));

  const system = [
    '你是一个目标驱动的 Agent。每一轮你做三件事：判断当前进展、决定是否还需要工具、决定是否结束。',
    '',
    '可用工具：',
    brief || '（本次没有提供任何工具）',
    '',
    '规则：',
    '1. 只在确实需要外部数据时调用工具；工具名与参数必须真实可用。',
    '2. 每轮最多一个工具调用。',
    '3. 信息足够时把 done 设为 true，并在 answer 里给出最终回答。',
    '4. 无法获得所需数据时，也要 done=true，并在 answer 里说明缺什么。',
    '5. 不要编造工具没有返回的数据。',
    '6. 只输出 JSON，不要解释。',
    '',
    schemaToPrompt(AGENT_STEP_SCHEMA),
  ].join('\n');

  const convo = [...messages, { role: 'system', content: system }];

  emitPromptBuilt(emit, {
    config,
    cfg,
    messages: convo,
    tools: [],
    mode: 'agent',
    extra: {
      toolNames,
      maxSteps,
      note: '工具是通过 JSON 决策「说」出来的，不是 API 层的 function calling；决策与终止都由模型给出，执行与校验由应用负责',
    },
  });

  emit('agent_goal_set', 'agent', {
    goal: question,
    tools: toolNames,
    maxSteps,
    stopConditions: ['模型声明 done=true', `达到步数上限 ${maxSteps}`, '工具连续失败 2 次'],
    note: '一个循环要成立，必须有明确的目标与终止条件；否则它只是在反复调用模型',
  });

  const steps = [];
  let step = 0;
  let llmCalls = 0;
  let consecutiveFailures = 0;

  while (step < maxSteps) {
    step += 1;
    emit('agent_step_started', 'agent', {
      step,
      maxSteps,
      note: '每一轮都是「看当前进展 → 决定下一步」的完整决策',
    });

    const decision = await jsonCall({
      config,
      messages: convo,
      schema: AGENT_STEP_SCHEMA,
      temperature: cfg.temperature,
      signal,
      emit,
      label: 'agent_decision',
      round: step,
    });
    llmCalls += 1;
    stats.llmCalls += 1;
    if (decision.usage) {
      stats.promptTokens += decision.usage.prompt_tokens || 0;
      stats.completionTokens += decision.usage.completion_tokens || 0;
    }

    const obj = decision.json;
    const errors = obj
      ? validateAgainstSchema(obj, AGENT_STEP_SCHEMA.schema)
      : [`决策不是合法 JSON：${decision.parseError}`];

    if (errors.length) {
      emit('agent_decision_invalid', 'agent', {
        step,
        errors,
        raw: decision.raw.slice(0, 1200),
        note: '决策格式不合规时，应用不会去猜它的意思；直接把问题回灌，要求重写',
      }, 'error');
      convo.push({ role: 'assistant', content: decision.raw || '（空）' });
      convo.push({
        role: 'user',
        content: `你的上一条输出不符合 Schema：\n${errorsToHint(errors)}\n请只输出修正后的 JSON。`,
      });
      continue;
    }

    const action = obj.next_action;
    emit('agent_step_decided', 'agent', {
      step,
      assessment: obj.assessment,
      done: obj.done,
      action: action ? { tool: action.tool, args: action.args, why: action.why } : null,
      note: obj.done
        ? '模型判断目标已达成，循环在这里终止'
        : action
          ? '模型决定再查一次；这一步之后它会看到新的观测，再重新判断'
          : '模型没有给出下一步动作，按终止处理',
    });

    if (obj.done || !action) {
      steps.push({ step, assessment: obj.assessment, action: null, ok: true });
      emit('agent_goal_reached', 'agent', {
        step,
        answerChars: (obj.answer || '').length,
        note: '终止条件命中：done=true。这是模型自己判断的，不是应用按轮数掐断的',
      });
      const answer = [renderSteps(steps), '## 二、最终回答', '', obj.answer || '（模型未给出回答）'].join('\n');
      return { answer, rounds: llmCalls, extra: { steps, done: true } };
    }

    if (!toolNames.includes(action.tool)) {
      emit('agent_action_invalid', 'agent', {
        step,
        tool: action.tool,
        tools: toolNames,
        note: '模型请求了清单外的工具，应用拒绝执行并回灌可用清单',
      }, 'error');
      convo.push({ role: 'assistant', content: decision.raw });
      convo.push({
        role: 'user',
        content: `工具 \`${action.tool}\` 不存在。可用工具：${toolNames.join('、')}。请重新决定。`,
      });
      continue;
    }

    const callId = newCallId('agent');
    const r = await runToolWithEvents({
      emit,
      stats,
      callId,
      name: action.tool,
      args: action.args || {},
      skillCtxs,
      sourceHint: 'agent',
    });

    consecutiveFailures = r.ok ? 0 : consecutiveFailures + 1;
    steps.push({
      step,
      assessment: obj.assessment,
      action: { tool: action.tool, args: action.args, why: action.why },
      ok: r.ok,
      summary: r.summary,
    });

    emit('agent_observation', 'agent', {
      step,
      ok: r.ok,
      chars: (r.content || '').length,
      observation: (r.content || '').slice(0, 1500),
      note: '观测结果被写回对话，下一轮模型会基于它重新判断进展',
    }, r.ok ? 'ok' : 'error');

    convo.push({ role: 'assistant', content: decision.raw });
    convo.push({
      role: 'user',
      content: `Observation（工具 ${action.tool} 的结果）：\n${r.ok ? r.content : `执行失败：${r.error}`}`,
    });

    if (consecutiveFailures >= 2) {
      emit('agent_goal_aborted', 'agent', {
        step,
        reason: '连续两次工具失败',
        note: '这是应用侧的熔断条件：与其继续消耗调用，不如停下来把失败原因摊开',
      }, 'error');
      break;
    }
  }

  emit('agent_budget_exhausted', 'agent', {
    step,
    maxSteps,
    note: '步数预算用尽：这是应用层的终止条件，不是模型认为自己做完了',
  }, 'error');

  const answer = [
    renderSteps(steps),
    '## 二、未能在预算内给出结论',
    '',
    `已执行 ${step} 步，达到上限 ${maxSteps}。上面的观测是真实的，但没有形成结论。`,
  ].join('\n');

  return { answer, rounds: llmCalls, extra: { steps, done: false, budgetExhausted: true } };
}
