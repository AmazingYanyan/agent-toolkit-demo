import { streamChat } from '../llm.mjs';
import { executeTool, toolMeta } from '../tools.mjs';
import { mcpRegistry, toolServerId } from '../mcp/registry.mjs';
import { readResource, runScript } from '../skills.mjs';

/**
 * 08–11 章共用的运行时工具。
 *
 * 四章共用同一套「请求体构造 / JSON 结构化调用 / 工具执行 + 事件」，
 * 差别只在控制流：单次结构化、目标循环、ReAct 文本协议、先规划再执行。
 */

export const SKILL_TOOL_NAMES = new Set(['read_skill_resource', 'run_skill_script']);

/** 统一构造并发出「构建模型请求」事件，保证各模式的请求体可核对 */
export function emitPromptBuilt(emit, { config, cfg, messages, tools, responseFormat, mode, extra = {} }) {
  const body = {
    model: config.model,
    messages,
    temperature: cfg.temperature,
    stream: true,
    stream_options: { include_usage: true },
    ...(tools && tools.length ? { tools, tool_choice: 'auto' } : {}),
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };
  emit('prompt_built', 'prompt_builder', {
    model: config.model,
    temperature: cfg.temperature,
    messages,
    tools: (tools || []).map((t) => t.function.name),
    toolsSchema: tools || [],
    requestBody: body,
    mode,
    toolSource: mode,
    messageCount: messages.length,
    schemaChars: tools && tools.length ? JSON.stringify(tools).length : 0,
    responseFormatType: responseFormat?.type || null,
    approxChars: messages.reduce((n, m) => n + String(m.content || '').length, 0),
    note:
      mode === 'structured'
        ? '这一次请求带 response_format，要求模型按给定 Schema 输出 JSON；结构是否合格由应用校验，不由模型自证'
        : '请求体就是这一屏的全部内容，工具、消息、温度都在里面',
    ...extra,
  });
  return body;
}

export function responseFormatFor(schema, kind) {
  if (!schema) return undefined;
  if (kind === 'json_schema') {
    return { type: 'json_schema', json_schema: { name: schema.name, strict: true, schema: schema.schema } };
  }
  return { type: 'json_object' };
}

/** 把 Schema 压成提示词里的说明（json_object 模式必需；json_schema 模式作为补充） */
export function schemaToPrompt(schema) {
  return [
    '你必须只输出一个 JSON 对象，不要输出解释、不要用 Markdown 代码块包裹。',
    'JSON 必须满足下面的结构（字段名与类型严格一致，不允许额外字段）：',
    JSON.stringify(schema.schema, null, 2),
  ].join('\n');
}

/**
 * 结构化调用：优先 json_schema；端点不支持时自动退回 json_object 并在事件里说明。
 * 返回解析后的对象与原始文本，两者都保留，便于事后核对。
 */
export async function jsonCall({
  config,
  messages,
  schema,
  temperature,
  signal,
  emit,
  label = 'structured_call',
  round = 1,
}) {
  const attempt = async (kind) => {
    const responseFormat = responseFormatFor(schema, kind);
    const started = Date.now();
    const res = await streamChat({
      config,
      messages,
      temperature,
      signal,
      responseFormat,
    });
    const raw = (res.content || '').trim();
    let json = null;
    let parseError = null;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      // 有些端点仍会包一层 ```json，做一次温和剥离后重试
      const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
      try {
        json = JSON.parse(stripped);
      } catch {
        parseError = e.message;
      }
    }
    return {
      kind,
      responseFormat,
      json,
      raw,
      parseError,
      usage: res.usage,
      durationMs: Date.now() - started,
      finishReason: res.finishReason,
    };
  };

  let result;
  try {
    result = await attempt('json_schema');
  } catch (err) {
    const unsupported = err.status === 400 || /response_format|json_schema/i.test(String(err.detail || err.message));
    if (!unsupported) throw err;
    emit('structured_fallback', 'structured', {
      from: 'json_schema',
      to: 'json_object',
      reason: `端点不接受 json_schema：${String(err.detail || err.message).slice(0, 200)}`,
      note: '自动退回 json_object 模式：约束写进提示词，结构由应用侧校验。这不是降级造假，是真实的能力差异',
    });
    result = await attempt('json_object');
  }

  emit('structured_call_completed', 'structured', {
    mode: label,
    round,
    responseFormat: result.responseFormat?.type || null,
    rawChars: result.raw.length,
    parsed: Boolean(result.json),
    parseError: result.parseError,
    usage: result.usage,
    durationMs: result.durationMs,
    raw: result.raw.slice(0, 4000),
  });

  return result;
}

/** 统一工具执行：本地函数 / MCP / Skill 能力包，事件与画布节点保持一致 */
export async function runToolWithEvents({ emit, stats, callId, name, args = {}, skillCtxs = [], sourceHint }) {
  const serverId = toolServerId(name);
  const isSkillTool = SKILL_TOOL_NAMES.has(name);
  const nodeId = isSkillTool
    ? name === 'read_skill_resource'
      ? 'skill_refs'
      : 'skill_script'
    : serverId
      ? `mcp_${serverId}`
      : `tool_${name}`;

  emit('tool_call_requested', 'tool_handler', {
    callId,
    toolName: name,
    source: isSkillTool ? 'skill' : serverId ? 'mcp' : 'local',
    serverId,
    args,
    sourceHint: sourceHint || null,
  });

  emit('permission_checked', 'tool_handler', {
    toolName: name,
    allowed: true,
    policy: isSkillTool ? 'skill-whitelist' : serverId ? 'default-allow' : 'default-allow',
    required: isSkillTool
      ? name === 'read_skill_resource'
        ? 'skill:resource:read'
        : 'skill:script:run'
      : serverId
        ? 'mcp:read'
        : toolMeta(name)?.permission || null,
    reason: isSkillTool
      ? '按清单白名单放行：只允许读登记过的文件 / 执行登记过的脚本'
      : serverId
        ? 'MCP 工具按服务器声明执行，当前策略默认放行'
        : '本地函数，当前演示策略默认放行',
  });

  emit('tool_call_started', isSkillTool ? nodeId : serverId ? 'mcp_client' : nodeId, {
    callId,
    toolName: name,
    serverId,
    args,
    via: isSkillTool ? 'skill' : serverId ? 'mcp' : 'local',
  }, 'running');

  try {
    let content = '';
    let summary = '';
    let data = null;
    let durationMs = 0;

    if (isSkillTool) {
      const target = skillCtxs.find((c) => c.id === args.skill_id);
      if (!target) {
        throw new Error(
          `本次未加载 Skill：${args.skill_id || '（未提供 skill_id）'}；可用的是 ${skillCtxs.map((c) => c.id).join('、')}`
        );
      }
      if (name === 'read_skill_resource') {
        const r = readResource(target.id, args.path, 1, args.reason);
        target.refs.push(r);
        content = r.text;
        summary = `${target.name} · ${r.title} ${r.chars} 字`;
        data = { skill_id: target.id, path: r.path, chars: r.chars };
        emit('skill_resource_read', 'skill_refs', {
          skillId: target.id,
          skillName: target.name,
          path: r.path,
          title: r.title,
          chars: r.chars,
          depth: 1,
          reason: args.reason,
          cumulativeRefChars: target.refs.reduce((n, x) => n + x.chars, 0),
          loaded: target.refs.map((x) => x.path),
          stillUnloaded: [...target.catalog.references, ...target.catalog.assets]
            .map((x) => x.path)
            .filter((p) => !target.refs.some((x) => x.path === p)),
          preview: r.text.slice(0, 300),
          note: '模型请求 → 应用按 skill_id 定位目录 → 白名单校验 → 读文件 → 作为工具结果返回',
        });
      } else {
        const r = await runScript(target.id, args.script, args.args || {});
        target.scripts.push(r);
        content = r.exitCode === 0 ? r.stdout : JSON.stringify({ error: `退出码 ${r.exitCode}`, stderr: r.stderr });
        summary = `${target.name} · ${r.name} 退出码 ${r.exitCode} · 输出 ${r.outputChars} 字`;
        data = { skill_id: target.id, exitCode: r.exitCode };
        durationMs = r.durationMs;
        emit('skill_script_run', 'skill_script', {
          skillId: target.id,
          skillName: target.name,
          script: r.script,
          name: r.name,
          title: r.title,
          args: r.args,
          argv: r.argv,
          exitCode: r.exitCode,
          timedOut: r.timedOut,
          stdout: r.stdout.slice(0, 3000),
          stderr: r.stderr,
          durationMs: r.durationMs,
          scriptChars: r.scriptChars,
          outputChars: r.outputChars,
          network: r.network,
          sideEffect: r.sideEffect,
          sourceSentToModel: false,
          note: '脚本源码没有进入上下文：应用只把标准输出回传给模型',
        }, r.exitCode === 0 ? 'success' : 'error');
      }
    } else if (serverId) {
      const r = await mcpRegistry.callTool(name, args);
      if (r.isError) throw new Error((r.text || 'MCP 工具执行失败').slice(0, 400));
      const text = r.text || JSON.stringify(r.structured ?? r.json ?? {});
      content = text;
      data = r.json ?? r.structured ?? { text };
      durationMs = r.durationMs;
      summary = `${r.serverLabel} · ${r.bare} 返回 ${text.length} 字`;
      emit('mcp_tools_call', 'mcp_client', {
        method: 'tools/call',
        serverId,
        server: r.serverLabel,
        tool: r.bare,
        arguments: args,
        protocolVersion: r.protocolVersion,
        durationMs: r.durationMs,
        trace: r.trace,
      });
    } else {
      const r = await executeTool(name, args);
      content = JSON.stringify(r.data);
      data = r.data;
      summary = r.summary;
      durationMs = r.durationMs || 0;
    }

    stats.toolCalls += 1;
    emit('tool_call_completed', isSkillTool ? nodeId : nodeId, {
      callId,
      toolName: name,
      serverId,
      result: data,
      summary,
      durationMs,
      via: isSkillTool ? 'skill' : serverId ? 'mcp' : 'local',
    });

    return { ok: true, content, summary, data, durationMs, nodeId };
  } catch (err) {
    emit('tool_call_failed', isSkillTool ? nodeId : serverId ? nodeId : nodeId, {
      callId,
      toolName: name,
      serverId,
      error: err.message,
    }, 'error');
    return { ok: false, content: JSON.stringify({ error: err.message }), summary: err.message, error: err.message, nodeId };
  }
}

/** 给规划器/决策器看的工具清单（只列名与用途，不含 schema 全文） */
export function toolBrief(tools) {
  return (tools || [])
    .map((t) => {
      const f = t.function || {};
      const desc = String(f.description || '').split('\n')[0].slice(0, 90);
      const params = Object.keys(f.parameters?.properties || {});
      return `- ${f.name}(${params.join(', ')})：${desc}`;
    })
    .join('\n');
}

export function newCallId(prefix = 'call') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
