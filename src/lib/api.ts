const BASE = '';

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err: any = new Error(data?.error || `请求失败 ${res.status}`);
    err.payload = data;
    throw err;
  }
  return data as T;
}

export const api = {
  health: () => json<any>('/api/health'),
  getConfig: () => json<any>('/api/config'),
  saveConfig: (patch: any) => json<any>('/api/config', { method: 'POST', body: JSON.stringify(patch) }),
  probe: () => json<any>('/api/probe', { method: 'POST' }),
  tools: () => json<any[]>('/api/tools'),
  kb: () => json<any>('/api/kb'),
  chunk: (id: string) => json<any>(`/api/kb/chunk/${id}`),
  reindex: () => json<any>('/api/kb/reindex', { method: 'POST' }),
  removeDoc: (docId: string) => json<any>(`/api/kb/${docId}`, { method: 'DELETE' }),
  search: (query: string, topK = 4, mode?: string) =>
    json<any>('/api/kb/search', { method: 'POST', body: JSON.stringify({ query, topK, mode }) }),
  uploadKb: (filename: string, content: string) =>
    json<any>('/api/kb/upload', { method: 'POST', body: JSON.stringify({ filename, content }) }),
  probeEmbedding: () => json<any>('/api/embedding/probe', { method: 'POST' }),
  skills: () => json<any[]>('/api/skills'),
  skillsIndex: () => json<any>('/api/skills/index'),
  skill: (id: string) => json<any>(`/api/skills/${id}`),
  skillResource: (id: string, relPath: string) =>
    json<any>(`/api/skills/${id}/resource?path=${encodeURIComponent(relPath)}`),
  skillSource: (id: string, relPath: string) =>
    json<any>(`/api/skills/${id}/source?path=${encodeURIComponent(relPath)}`),
  skillRun: (id: string, script: string, args: any) =>
    json<any>(`/api/skills/${id}/run`, { method: 'POST', body: JSON.stringify({ script, args }) }),
  toolSchema: (cfg: any) => json<any>('/api/tools/schema', { method: 'POST', body: JSON.stringify(cfg) }),
  mcpServers: () => json<any>('/api/mcp/servers'),
  mcpSync: () => json<any>('/api/mcp/sync', { method: 'POST' }),
  mcpTest: (id: string) => json<any>(`/api/mcp/servers/${id}/test`, { method: 'POST' }),
  mcpToggle: (id: string, enabled: boolean) =>
    json<any>(`/api/mcp/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  mcpAdd: (server: any) => json<any>('/api/mcp/servers', { method: 'POST', body: JSON.stringify(server) }),
  mcpRemove: (id: string) => json<any>(`/api/mcp/servers/${id}`, { method: 'DELETE' }),
  mcpStatus: () => json<any>('/api/mcp/status'),
  mcpConnect: () => json<any>('/api/mcp/connect', { method: 'POST' }),
  demoData: () => json<any>('/api/demo-data'),
  runs: () => json<any[]>('/api/runs'),
  run: (id: string) => json<any>(`/api/runs/${id}`),
  cancel: (id: string) => json<any>(`/api/run/${id}/cancel`, { method: 'POST' }),
};

export interface StreamHandlers {
  onRunCreated?: (runId: string) => void;
  onEvent?: (evt: any) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

export async function streamRun(
  body: { question: string; config: any; history: any[] },
  handlers: StreamHandlers,
  signal?: AbortSignal
) {
  let res: Response;
  try {
    res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err: any) {
    handlers.onError?.(err.message);
    handlers.onEnd?.();
    return;
  }

  if (!res.ok || !res.body) {
    let message = `运行失败（${res.status}）`;
    try {
      const data = await res.json();
      message = data.error || message;
    } catch {
      /* ignore */
    }
    handlers.onError?.(message);
    handlers.onEnd?.();
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        let data: any;
        try {
          data = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (data.type === 'run_created') handlers.onRunCreated?.(data.runId);
        else if (data.type === 'stream_end') continue;
        else handlers.onEvent?.(data);
      }
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') handlers.onError?.(err.message);
  } finally {
    handlers.onEnd?.();
  }
}
