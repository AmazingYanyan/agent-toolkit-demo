/**
 * 结构化输出的 Schema 与小而严格的校验器。
 *
 * 为什么自己写校验：模型返回的 JSON 只是「看起来像」，字段缺失、类型漂移、多给字段都很常见。
 * 约束要写在请求里，校验要落在应用侧，两件事缺一不可。
 */

// ---------------------------------------------------------------------------
// 通用校验器（够用即止，但求严格）
// ---------------------------------------------------------------------------

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function matchType(value, expected) {
  const list = Array.isArray(expected) ? expected : [expected];
  const actual = typeOf(value);
  return list.some((t) => {
    if (t === 'number') return actual === 'number' || actual === 'integer';
    if (t === 'integer') return actual === 'integer';
    return t === actual;
  });
}

/**
 * 返回错误数组；空数组表示通过。
 * path 用点号表示，数组下标用 [i]。
 */
export function validateAgainstSchema(value, schema, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type && !matchType(value, schema.type)) {
    errors.push(`${path}: 期望类型 ${[].concat(schema.type).join('|')}，实际 ${typeOf(value)}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: 取值必须是 ${schema.enum.join(' / ')} 之一，实际 ${JSON.stringify(value)}`);
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: 不得小于 ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: 不得大于 ${schema.maximum}`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      errors.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`));
    });
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${path}: 至少 ${schema.minItems} 项，实际 ${value.length} 项`);
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push(`${path}: 最多 ${schema.maxItems} 项，实际 ${value.length} 项`);
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) {
      if (!(key in value)) errors.push(`${path}.${key}: 缺少必填字段`);
    }
    const props = schema.properties || {};
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) {
        errors.push(...validateAgainstSchema(v, props[key], `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: 不允许的额外字段`);
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// ch08：企业风险结构化抽取
// ---------------------------------------------------------------------------

const nullableNumber = { type: ['number', 'null'] };

export const RISK_SCHEMA = {
  name: 'enterprise_risk_extraction',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['company', 'period', 'metrics', 'evidence', 'confidence', 'data_gaps'],
    properties: {
      company: { type: 'string', description: '企业名称；未提供时填「未提供」' },
      period: { type: 'string', description: '数据所属期间，例如 2025 年度' },
      metrics: {
        type: 'object',
        additionalProperties: false,
        required: [
          'revenue_current',
          'revenue_prior',
          'total_assets',
          'total_liabilities',
          'operating_cash_flow',
        ],
        properties: {
          revenue_current: nullableNumber,
          revenue_prior: nullableNumber,
          total_assets: nullableNumber,
          total_liabilities: nullableNumber,
          operating_cash_flow: nullableNumber,
        },
      },
      evidence: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['field', 'quote'],
          properties: {
            field: { type: 'string' },
            quote: { type: 'string', description: '原文摘录，不得改写' },
          },
        },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      data_gaps: {
        type: 'array',
        maxItems: 6,
        items: { type: 'string' },
        description: '未能从原文确认的字段或事实',
      },
    },
  },
};

/** 数值口径统一：全部按「万元」处理；模型若给了字符串数字，这里不宽容，直接判错 */
export function normalizeRiskJson(obj) {
  const m = obj?.metrics || {};
  const pick = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    revenue_current: pick(m.revenue_current),
    revenue_prior: pick(m.revenue_prior),
    total_assets: pick(m.total_assets),
    total_liabilities: pick(m.total_liabilities),
    operating_cash_flow: pick(m.operating_cash_flow),
  };
}

// ---------------------------------------------------------------------------
// ch11：计划
// ---------------------------------------------------------------------------

export const PLAN_SCHEMA = {
  name: 'execution_plan',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['goal', 'reasoning', 'steps'],
    properties: {
      goal: { type: 'string', description: '对用户目标的复述，一句话' },
      reasoning: { type: 'string', description: '为什么这样拆步骤' },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'tool', 'args', 'expect'],
          properties: {
            id: { type: 'integer' },
            title: { type: 'string', description: '这一步做什么，短句' },
            tool: { type: 'string', description: '要调用的工具名，必须来自给定清单' },
            args: { type: 'object', additionalProperties: true },
            expect: { type: 'string', description: '期望从这一步得到什么' },
          },
        },
      },
    },
  },
};

export const PLAN_REVISE_SCHEMA = {
  name: 'plan_revision',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['reason', 'revised_steps'],
    properties: {
      reason: { type: 'string', description: '为什么要改计划' },
      revised_steps: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'title', 'tool', 'args', 'expect'],
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            tool: { type: 'string' },
            args: { type: 'object', additionalProperties: true },
            expect: { type: 'string' },
          },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// ch09：目标驱动循环的单步决策
// ---------------------------------------------------------------------------

export const AGENT_STEP_SCHEMA = {
  name: 'agent_step_decision',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['assessment', 'done', 'next_action', 'answer'],
    properties: {
      assessment: { type: 'string', description: '对当前进展的判断，一到两句' },
      done: { type: 'boolean', description: '目标是否已经达成' },
      next_action: {
        type: ['object', 'null'],
        additionalProperties: false,
        required: ['tool', 'args', 'why'],
        properties: {
          tool: { type: 'string' },
          args: { type: 'object', additionalProperties: true },
          why: { type: 'string' },
        },
      },
      answer: { type: 'string', description: 'done 为 true 时给用户的最终回答；否则填空字符串' },
    },
  },
};

/** 把校验错误压成一句给模型看的修正提示 */
export function errorsToHint(errors) {
  return errors.slice(0, 8).map((e) => `- ${e}`).join('\n');
}
