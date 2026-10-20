/**
 * LLM 适配层：兼容 OpenAI Chat Completions 协议。
 * 只使用标准字段，便于切换到 DeepSeek / 通义 / 内网兼容网关。
 */

export class LLMError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = extra.status;
    this.detail = extra.detail;
  }
}

function endpoint(baseUrl, suffix) {
  const base = (baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new LLMError('未配置模型服务地址');
  // 允许用户填写 .../v1 或完整 .../v1/chat/completions
  if (base.endsWith('/chat/completions')) return base;
  return `${base}${suffix}`;
}

/**
 * 流式对话。onDelta 用于把真实增量输出推给前端。
 * 返回完整聚合结果：content、toolCalls、usage、finishReason。
 */
export async function streamChat({
  config,
  messages,
  tools,
  temperature,
  onDelta,
  signal,
  maxToolChoice = 'auto',
}) {
  if (!config.apiKey) throw new LLMError('未配置 API Key，请在设置中填写模型服务凭据');
  const url = endpoint(config.baseUrl, '/chat/completions');

  const body = {
    model: config.model,
    messages,
    temperature: typeof temperature === 'number' ? temperature : config.temperature,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = maxToolChoice;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs || 90000);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err.name === 'AbortError' ? '模型请求超时或被取消' : `无法连接模型服务：${err.message}`;
    throw new LLMError(msg, { detail: String(err) });
  }

  if (!res.ok) {
    clearTimeout(timeout);
    const text = await res.text().catch(() => '');
    throw new LLMError(`模型服务返回 ${res.status}`, {
      status: res.status,
      detail: text.slice(0, 800),
    });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let content = '';
  const toolAcc = new Map();
  let finishReason = null;
  let usage = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        if (json.usage) usage = json.usage;
        const choice = json.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const delta = choice.delta || {};
        if (delta.content) {
          content += delta.content;
          onDelta?.(delta.content);
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const key = tc.index ?? 0;
            const cur = toolAcc.get(key) || { id: '', name: '', arguments: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name += tc.function.name;
            if (tc.function?.arguments) cur.arguments += tc.function.arguments;
            toolAcc.set(key, cur);
          }
        }
      }
    }
  } finally {
    clearTimeout(timeout);
  }

  const toolCalls = [...toolAcc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v], i) => ({
      id: v.id || `call_${Date.now()}_${i}`,
      name: v.name,
      arguments: v.arguments,
    }))
    .filter((t) => t.name);

  return {
    content,
    toolCalls,
    usage,
    finishReason,
    durationMs: Date.now() - started,
    endpoint: url,
    requestBody: { model: config.model, temperature: body.temperature, hasTools: Boolean(tools?.length) },
  };
}

/** 连通性与能力自检：发一条极短的非流式请求 */
export async function probeModel(config) {
  if (!config.apiKey) return { ok: false, reason: '未配置 API Key' };
  const url = endpoint(config.baseUrl, '/chat/completions');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: '回复"ok"两个字符即可' }],
        max_tokens: 8,
        temperature: 0,
      }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}`, detail: text.slice(0, 400) };
    }
    let json = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* 部分网关返回非 JSON */
    }
    return {
      ok: true,
      model: json.model || config.model,
      latencyMs: null,
      reply: json.choices?.[0]?.message?.content?.slice(0, 40) || '',
      endpoint: url,
    };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? '连接超时' : err.message };
  } finally {
    clearTimeout(timeout);
  }
}
