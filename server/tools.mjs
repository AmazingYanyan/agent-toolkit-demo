import { findCompany, findFinancials, computeMetrics, runRules, readDb } from './db.mjs';

/**
 * 工具注册表。
 * 每条工具同时包含「模型可见的定义」与「程序侧的元数据」，
 * 模型只拿到 name/description/parameters，权限与副作用标记只留在服务端。
 */

const HINTS = '企业编号对照：DEMO001=星河科技有限公司（演示企业A）, DEMO002=晨光制造有限公司（演示企业B）。';

export const TOOL_REGISTRY = {
  get_company_info: {
    meta: {
      label: '企业工商信息查询',
      category: '外部数据',
      readOnly: true,
      permission: 'company:read',
      requiresApproval: false,
      dataSource: '本地演示工商库',
      timeoutMs: 5000,
    },
    definition: {
      type: 'function',
      function: {
        name: 'get_company_info',
        description: `查询企业工商登记信息，返回企业名称、注册资本、登记状态、数据来源与更新时间。${HINTS}`,
        parameters: {
          type: 'object',
          properties: {
            company_id: {
              type: 'string',
              description: '企业编号或企业名称，例如 DEMO001',
            },
          },
          required: ['company_id'],
        },
      },
    },
    async execute(args) {
      const company = findCompany(args.company_id);
      if (!company) throw new Error(`未找到企业：${args.company_id}`);
      const db = readDb();
      return {
        data: {
          company_id: company.company_id,
          name: company.name,
          registered_capital: company.registered_capital,
          capital_unit: company.capital_unit,
          status: company.status,
          established: company.established,
          industry: company.industry,
          source: company.source,
          updated_at: company.updated_at,
          data_version: db.version,
        },
        summary: `${company.name} 注册资本 ${company.registered_capital}${company.capital_unit}，状态 ${company.status}`,
        source: company.source,
        dataVersion: db.version,
      };
    },
  },

  get_company_financials: {
    meta: {
      label: '企业财务数据查询',
      category: '外部数据',
      readOnly: true,
      permission: 'financial:read',
      requiresApproval: false,
      dataSource: '本地演示财务库',
      timeoutMs: 5000,
    },
    definition: {
      type: 'function',
      function: {
        name: 'get_company_financials',
        description: `查询企业在演示库中的财务数据（营业收入、总资产、总负债、经营活动现金流净额）。${HINTS}`,
        parameters: {
          type: 'object',
          properties: {
            company_id: { type: 'string', description: '企业编号或名称' },
            year: { type: 'integer', description: '年份，可选。不填则返回全部年份' },
          },
          required: ['company_id'],
        },
      },
    },
    async execute(args) {
      const found = findFinancials(args.company_id, args.year);
      if (!found) throw new Error(`未找到企业财务数据：${args.company_id}`);
      const db = readDb();
      return {
        data: {
          company_id: found.company.company_id,
          name: found.company.name,
          unit: '万元',
          financials: found.rows,
          data_version: db.version,
        },
        summary: `${found.company.name} 共 ${found.rows.length} 个年度财务记录`,
        source: '本地演示财务库',
        dataVersion: db.version,
      };
    },
  },

  calculate_ratio: {
    meta: {
      label: '确定性指标计算',
      category: '计算',
      readOnly: true,
      permission: 'calc:run',
      requiresApproval: false,
      dataSource: '本地确定性计算程序',
      timeoutMs: 2000,
    },
    definition: {
      type: 'function',
      function: {
        name: 'calculate_ratio',
        description:
          '用确定性程序计算比率或变动率，避免模型自行口算产生误差。返回精确数值（保留两位小数）。',
        parameters: {
          type: 'object',
          properties: {
            label: { type: 'string', description: '指标名称，例如 资产负债率' },
            numerator: { type: 'number', description: '分子' },
            denominator: { type: 'number', description: '分母' },
            mode: {
              type: 'string',
              enum: ['percent', 'ratio'],
              description: 'percent 表示输出百分数并保留两位小数；ratio 输出普通比值',
            },
          },
          required: ['label', 'numerator', 'denominator'],
        },
      },
    },
    async execute(args) {
      const { numerator, denominator, label } = args;
      if (typeof numerator !== 'number' || typeof denominator !== 'number') {
        throw new Error('numerator 与 denominator 必须为数字');
      }
      if (denominator === 0) throw new Error('分母不能为 0');
      const mode = args.mode || 'percent';
      const raw = numerator / denominator;
      const value = mode === 'percent' ? Math.round(raw * 10000) / 100 : Math.round(raw * 10000) / 10000;
      return {
        data: {
          label,
          numerator,
          denominator,
          value,
          unit: mode === 'percent' ? '%' : '',
          formula: `${label} = ${numerator} / ${denominator}`,
        },
        summary: `${label} = ${value}${mode === 'percent' ? '%' : ''}`,
        source: '本地确定性计算程序',
      };
    },
  },

  evaluate_risk_rules: {
    meta: {
      label: '演示风险规则引擎',
      category: '确定性规则',
      readOnly: true,
      permission: 'rule:run',
      requiresApproval: false,
      dataSource: '本地规则引擎',
      timeoutMs: 2000,
    },
    definition: {
      type: 'function',
      function: {
        name: 'evaluate_risk_rules',
        description:
          '由确定性规则引擎计算企业指标并判断演示风险提示规则是否触发。阈值判断不交由模型完成。',
        parameters: {
          type: 'object',
          properties: {
            company_id: { type: 'string', description: '企业编号或名称' },
          },
          required: ['company_id'],
        },
      },
    },
    async execute(args) {
      const company = findCompany(args.company_id);
      if (!company) throw new Error(`未找到企业：${args.company_id}`);
      const metrics = computeMetrics(company);
      const rules = runRules(metrics);
      return {
        data: { company_id: company.company_id, metrics, rules },
        summary: rules.map((r) => `${r.id} ${r.name}:${r.triggered ? '触发' : '未触发'}`).join('；'),
        source: '本地规则引擎',
      };
    },
  },
};

export function toolDefinitions(names) {
  return names.filter((n) => TOOL_REGISTRY[n]).map((n) => TOOL_REGISTRY[n].definition);
}

export function toolMeta(name) {
  return TOOL_REGISTRY[name]?.meta || null;
}

/** 权限校验：第一阶段尚无完整权限体系，默认放行但要如实记录 */
export function checkPermission(_user, toolName) {
  const meta = toolMeta(toolName);
  if (!meta) return { allowed: false, reason: `工具未注册：${toolName}` };
  return {
    allowed: true,
    reason: `第一阶段未启用分级权限策略，当前演示用户默认放行（所需权限：${meta.permission}）`,
    policy: 'default-allow',
  };
}

export async function executeTool(name, args) {
  const tool = TOOL_REGISTRY[name];
  if (!tool) throw new Error(`工具未注册：${name}`);
  const started = Date.now();
  const result = await tool.execute(args || {});
  return { ...result, durationMs: Date.now() - started, toolName: name };
}

export const ALL_TOOL_NAMES = Object.keys(TOOL_REGISTRY);
