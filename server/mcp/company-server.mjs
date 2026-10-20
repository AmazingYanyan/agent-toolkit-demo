#!/usr/bin/env node
/**
 * 真实 MCP Server（stdio 传输，JSON-RPC 2.0，按行分隔消息）。
 * 协议版本对齐 MCP 2024-11-05：initialize / tools/list / tools/call / ping。
 *
 * 这不是用 REST 接口包装后的伪 MCP：客户端通过 stdin/stdout 与本进程做协议交互，
 * 由本进程自行声明能力、暴露工具清单，并在收到调用后执行真实数据查询。
 */
import { findCompany, readDb } from '../db.mjs';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'demo-company-registry', version: '1.0.0' };

const TOOLS = [
  {
    name: 'get_company_info',
    description:
      '查询企业工商登记信息（注册资本、登记状态、数据来源）。本工具通过 MCP Server 提供，调用方无需了解底层服务地址。企业编号对照：DEMO001=星河科技（演示企业A），DEMO002=晨光制造（演示企业B）。',
    inputSchema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: '企业编号或名称' },
      },
      required: ['company_id'],
    },
  },
];

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handleToolsCall(params) {
  const name = params?.name;
  const args = params?.arguments || {};
  if (name !== 'get_company_info') {
    throw Object.assign(new Error(`未知工具：${name}`), { code: -32602 });
  }
  const company = findCompany(args.company_id);
  if (!company) throw new Error(`未找到企业：${args.company_id}`);
  const db = readDb();
  const payload = {
    company_id: company.company_id,
    name: company.name,
    registered_capital: company.registered_capital,
    capital_unit: company.capital_unit,
    status: company.status,
    industry: company.industry,
    source: company.source,
    updated_at: company.updated_at,
    data_version: db.version,
    via: 'mcp',
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: false,
  };
}

let initialized = false;

function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      initialized = true;
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: '演示用企业工商信息 MCP Server，仅提供本地虚构数据。',
      });
      return;
    }
    case 'notifications/initialized':
      return;
    case 'ping':
      if (!isNotification) reply(id, {});
      return;
    case 'tools/list':
      reply(id, { tools: TOOLS });
      return;
    case 'tools/call':
      try {
        reply(id, handleToolsCall(params));
      } catch (err) {
        reply(id, {
          content: [{ type: 'text', text: `工具执行失败：${err.message}` }],
          isError: true,
        });
      }
      return;
    case 'resources/list':
      reply(id, { resources: [] });
      return;
    case 'prompts/list':
      reply(id, { prompts: [] });
      return;
    default:
      if (!isNotification) replyError(id, -32601, `Method not found: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      handle(msg);
    } catch (err) {
      if (msg.id !== undefined) replyError(msg.id, -32603, String(err.message || err));
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// 确保初始化完成前不退出
if (!initialized) {
  process.stderr.write('[mcp] demo-company-registry ready, protocol ' + PROTOCOL_VERSION + '\n');
}
