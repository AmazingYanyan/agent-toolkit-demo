import {
  emitPromptBuilt,
  jsonCall,
  responseFormatFor,
  schemaToPrompt,
} from './shared.mjs';
import {
  RISK_SCHEMA,
  validateAgainstSchema,
  normalizeRiskJson,
  errorsToHint,
} from './schema.mjs';
import { evaluateRules } from '../rules.mjs';

/**
 * 第八章：结构化输出与确定性规则。
 *
 * 三个必须分开的环节：
 *   1) 约束：请求里带 response_format，明确要求按 Schema 输出
 *   2) 校验：应用侧逐字段校验，不合格就带着错误清单让模型修一次
 *   3) 判定：阈值判断交给确定性规则引擎；最终回答由模板渲染，不让模型自由发挥
 */

const fmt = (v, unit = '') => (v == null ? '—' : `${v}${unit}`);

function renderRiskReport(obj, evaluation, meta) {
  const m = obj.metrics || {};
  const lines = [];
  lines.push('## 一、结构化抽取（模型填写，应用校验）');
  lines.push('');
  lines.push('| 字段 | 值 | 单位 |');
  lines.push('| --- | --- | --- |');
  lines.push(`| 企业 | ${obj.company || '未提供'} | — |`);
  lines.push(`| 期间 | ${obj.period || '未提供'} | — |`);
  lines.push(`| 本期营业收入 | ${fmt(m.revenue_current)} | 万元 |`);
  lines.push(`| 上期营业收入 | ${fmt(m.revenue_prior)} | 万元 |`);
  lines.push(`| 总资产 | ${fmt(m.total_assets)} | 万元 |`);
  lines.push(`| 总负债 | ${fmt(m.total_liabilities)} | 万元 |`);
  lines.push(`| 经营活动现金流量净额 | ${fmt(m.operating_cash_flow)} | 万元 |`);
  lines.push(`| 抽取置信度 | ${obj.confidence || '—'} | — |`);
  lines.push('');

  if ((obj.data_gaps || []).length) {
    lines.push('**未能确认的项**：' + obj.data_gaps.join('；'));
    lines.push('');
  }

  const d = evaluation.derived;
  lines.push('## 二、指标计算（应用计算，不由模型口算）');
  lines.push('');
  lines.push(`- 资产负债率 = 总负债 ÷ 总资产 = **${fmt(d.debt_asset_ratio_display, '%')}**`);
  lines.push(`- 营业收入同比变动率 = （本期 − 上期）÷ 上期 = **${fmt(d.revenue_yoy_display, '%')}**`);
  lines.push(`- 所有者权益 = 总资产 − 总负债 = **${fmt(d.equity, ' 万元')}**`);
  lines.push('');

  lines.push('## 三、规则判定（确定性引擎执行，非模型判断）');
  lines.push('');
  lines.push('| 规则 | 阈值 | 实际 | 结论 |');
  lines.push('| --- | --- | --- | --- |');
  for (const r of evaluation.results) {
    const label = r.status === 'triggered' ? '**触发**' : r.status === 'not_triggered' ? '未触发' : '无法判定';
    lines.push(`| ${r.id} ${r.name} | ${r.display?.threshold || '—'} | ${r.display?.value ?? '—'}${r.display?.unit || ''} | ${label} |`);
  }
  lines.push('');

  lines.push('## 四、结论');
  lines.push('');
  lines.push(evaluation.verdict);
  lines.push('');
  lines.push(`> ${evaluation.ruleBasis}`);
  lines.push('');

  if ((obj.evidence || []).length) {
    lines.push('## 五、原文依据');
    lines.push('');
    for (const e of obj.evidence.slice(0, 6)) {
      lines.push(`- \`${e.field}\`：${String(e.quote || '').replace(/\n/g, ' ').slice(0, 120)}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(
    `本回答由「结构化对象 + 规则结果」按模板渲染（模型 ${meta.model}，结构化调用 ${meta.llmCalls} 次）。` +
      '模型没有直接撰写上面的表格与结论，它只负责把文字里的数抽成 JSON。'
  );
  return lines.join('\n');
}

export async function runStructured({ config, cfg, question, messages, emit, signal, stats }) {
  const schemaMessages = [...messages, { role: 'system', content: schemaToPrompt(RISK_SCHEMA) }];
  const promptBody = emitPromptBuilt(emit, {
    config,
    cfg,
    messages: schemaMessages,
    tools: [],
    responseFormat: responseFormatFor(RISK_SCHEMA, 'json_schema'),
    mode: 'structured',
    extra: { schemaName: RISK_SCHEMA.name },
  });

  emit('structured_schema_sent', 'structured', {
    schemaName: RISK_SCHEMA.name,
    responseFormat: 'json_schema',
    strict: true,
    fields: Object.keys(RISK_SCHEMA.schema.properties),
    schema: RISK_SCHEMA.schema,
    schemaChars: JSON.stringify(RISK_SCHEMA.schema).length,
    requestBytes: JSON.stringify(promptBody).length,
    note: '这一段 JSON Schema 随请求发出，是「约束」；它不是提示词建议，端点会按它规范输出',
  });

  let llmCalls = 0;
  const first = await jsonCall({
    config,
    messages: schemaMessages,
    schema: RISK_SCHEMA,
    temperature: cfg.temperature,
    signal,
    emit,
    label: 'extract',
    round: 1,
  });
  llmCalls += 1;
  stats.llmCalls += 1;
  if (first.usage) {
    stats.promptTokens += first.usage.prompt_tokens || 0;
    stats.completionTokens += first.usage.completion_tokens || 0;
  }

  emit('structured_output_received', 'structured', {
    round: 1,
    responseFormat: first.responseFormat?.type || null,
    raw: first.raw.slice(0, 4000),
    rawChars: first.raw.length,
    parsed: Boolean(first.json),
    parseError: first.parseError,
    durationMs: first.durationMs,
    note: first.json
      ? '模型返回的是一段文本，应用先把它当成字符串解析成对象，再看结构对不对'
      : '返回的内容不是合法 JSON —— 这不是异常，而是需要应用处理的真实情况',
  });

  let obj = first.json;
  let errors = obj
    ? validateAgainstSchema(obj, RISK_SCHEMA.schema)
    : [`输出不是合法 JSON：${first.parseError || '无法解析'}`];

  emit('schema_validated', 'structured', {
    round: 1,
    ok: errors.length === 0,
    errors,
    errorCount: errors.length,
    note:
      errors.length === 0
        ? '逐字段校验通过：类型、必填、额外字段、枚举都符合 Schema'
        : '校验未通过：下面这些具体问题由应用发现，说明「模型说它按格式输出」不等于「格式真的对」',
  });

  // 只修一次：真实工程里也是有限次重试，不做无限重写
  if (errors.length) {
    emit('structured_repair_requested', 'structured', {
      errors,
      hint: errorsToHint(errors),
      note: '带着错误清单让模型重写一次；重试次数上限 1 次，避免无限循环',
    });
    const repairMessages = [
      ...schemaMessages,
      { role: 'assistant', content: first.raw || '（空）' },
      {
        role: 'user',
        content: `上面的输出不满足 Schema，具体问题：\n${errorsToHint(errors)}\n请只输出修正后的 JSON 对象，不要解释。`,
      },
    ];
    const second = await jsonCall({
      config,
      messages: repairMessages,
      schema: RISK_SCHEMA,
      temperature: 0,
      signal,
      emit,
      label: 'repair',
      round: 2,
    });
    llmCalls += 1;
    stats.llmCalls += 1;
    if (second.usage) {
      stats.promptTokens += second.usage.prompt_tokens || 0;
      stats.completionTokens += second.usage.completion_tokens || 0;
    }

    obj = second.json;
    errors = obj ? validateAgainstSchema(obj, RISK_SCHEMA.schema) : [`修复后仍不是合法 JSON：${second.parseError}`];
    emit('schema_validated', 'structured', {
      round: 2,
      ok: errors.length === 0,
      errors,
      errorCount: errors.length,
      note: errors.length === 0 ? '第二次通过校验' : '第二次仍未通过：下面会如实停止，不伪造结构化结果',
    });
  }

  if (!obj || errors.length) {
    emit('structured_failed', 'structured', {
      errors,
      note: '结构化失败时不再往下跑规则引擎——拿一个不合规的对象去判定，只会得到看似精确实则错误的结果',
    }, 'error');
    return {
      answer:
        '## 结构化输出失败\n\n模型两次都没有给出符合 Schema 的 JSON，应用已停止后续流程。\n\n' +
        '具体问题：\n\n' +
        errors.map((e) => `- ${e}`).join('\n') +
        '\n\n> 这里没有降级为「让模型随便说说」——结构不合规就是不合规，规则引擎不能建立在这上面。',
      rounds: llmCalls,
      extra: { structured: null, rules: null, errors },
    };
  }

  const metrics = normalizeRiskJson(obj);
  const evaluation = evaluateRules(metrics);

  emit('rules_evaluated', 'rules', {
    engine: 'deterministic',
    input: metrics,
    derived: evaluation.derived,
    results: evaluation.results,
    triggeredCount: evaluation.triggeredCount,
    unknownCount: evaluation.unknownCount,
    verdict: evaluation.verdict,
    ruleBasis: evaluation.ruleBasis,
    note: '这一步没有任何模型参与：输入是校验通过的数值，阈值比较由代码执行，结论可复现',
  });

  const answer = renderRiskReport(obj, evaluation, { model: config.model, llmCalls });
  emit('structured_answer_rendered', 'report', {
    source: 'structured_object + rule_results',
    template: 'risk_report_v1',
    chars: answer.length,
    llmCalls,
    note: '最终回答由程序按模板渲染，不是模型自由撰写——这样每一格数字都能追溯到来源',
  });

  return {
    answer,
    rounds: llmCalls,
    extra: { structured: obj, rules: evaluation, schemaErrors: errors },
  };
}
