/**
 * 确定性规则引擎。
 *
 * 这一层不调用任何模型：输入是结构化数值，输出是判定结果。
 * 「阈值是否触发」这件事必须由程序说了算，模型只负责把文本里的数抽出来。
 */

export const RULE_DEFS = [
  {
    id: 'R01',
    name: '资产负债率高于 70%',
    metric: 'debt_asset_ratio',
    op: '>',
    threshold: 0.7,
    unit: '%',
    scale: 100,
    note: '演示用虚构阈值，不代表行内正式授信政策',
  },
  {
    id: 'R02',
    name: '营业收入同比下降超过 15%',
    metric: 'revenue_yoy',
    op: '<',
    threshold: -0.15,
    unit: '%',
    scale: 100,
    note: '演示用虚构阈值，不代表行内正式授信政策',
  },
  {
    id: 'R03',
    name: '经营活动现金流净额为负',
    metric: 'operating_cash_flow',
    op: '<',
    threshold: 0,
    unit: '万元',
    scale: 1,
    note: '演示用虚构阈值，不代表行内正式授信政策',
  },
];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v, n = 4) => (v == null ? null : Math.round(v * 10 ** n) / 10 ** n);

/** 由原始字段推导比率；缺字段时返回 null，绝不臆造 */
export function deriveMetrics(m) {
  const revenueCurrent = num(m.revenue_current);
  const revenuePrior = num(m.revenue_prior);
  const assets = num(m.total_assets);
  const liabilities = num(m.total_liabilities);
  const ocf = num(m.operating_cash_flow);

  const debtAssetRatio =
    assets != null && assets > 0 && liabilities != null ? round(liabilities / assets) : null;
  const revenueYoy =
    revenuePrior != null && revenuePrior !== 0 && revenueCurrent != null
      ? round((revenueCurrent - revenuePrior) / revenuePrior)
      : null;

  return {
    debt_asset_ratio: debtAssetRatio,
    revenue_yoy: revenueYoy,
    operating_cash_flow: ocf,
    equity: assets != null && liabilities != null ? round(assets - liabilities) : null,
  };
}

function compare(value, op, threshold) {
  if (op === '>') return value > threshold;
  if (op === '<') return value < threshold;
  if (op === '>=') return value >= threshold;
  if (op === '<=') return value <= threshold;
  return false;
}

/**
 * 逐条判定。每条给出三态：triggered / not_triggered / not_evaluable。
 * not_evaluable 是重要的一档——数据不足时不能默认「没问题」。
 */
export function evaluateRules(metrics) {
  const derived = deriveMetrics(metrics);

  const results = RULE_DEFS.map((def) => {
    const value = derived[def.metric];
    if (value == null) {
      return {
        id: def.id,
        name: def.name,
        status: 'not_evaluable',
        threshold: def.threshold,
        display: { value: null, threshold: def.op + ' ' + def.threshold * def.scale + def.unit },
        reason: `缺少 ${def.metric} 所需字段，本条规则无法判定`,
      };
    }
    const hit = compare(value, def.op, def.threshold);
    return {
      id: def.id,
      name: def.name,
      status: hit ? 'triggered' : 'not_triggered',
      threshold: def.threshold,
      actual: value,
      display: {
        value: round(value * def.scale, 2),
        threshold: def.op + ' ' + round(def.threshold * def.scale, 2) + def.unit,
        unit: def.unit,
      },
      reason: hit
        ? `实际 ${round(value * def.scale, 2)}${def.unit} 满足 ${def.op} ${round(def.threshold * def.scale, 2)}${def.unit}`
        : `实际 ${round(value * def.scale, 2)}${def.unit} 不满足 ${def.op} ${round(def.threshold * def.scale, 2)}${def.unit}`,
    };
  });

  const triggered = results.filter((r) => r.status === 'triggered');
  const unknown = results.filter((r) => r.status === 'not_evaluable');

  return {
    derived: {
      debt_asset_ratio: derived.debt_asset_ratio,
      debt_asset_ratio_display:
        derived.debt_asset_ratio == null ? null : round(derived.debt_asset_ratio * 100, 2),
      revenue_yoy: derived.revenue_yoy,
      revenue_yoy_display: derived.revenue_yoy == null ? null : round(derived.revenue_yoy * 100, 2),
      operating_cash_flow: derived.operating_cash_flow,
      equity: derived.equity,
    },
    results,
    triggered,
    unknown,
    triggeredCount: triggered.length,
    unknownCount: unknown.length,
    // 结论只描述「规则层面」，不给授信审批意见
    verdict:
      unknown.length === results.length
        ? '数据不足，全部规则无法判定'
        : triggered.length === 0
          ? unknown.length > 0
            ? `已判定的 ${results.length - unknown.length} 条规则均未触发，另有 ${unknown.length} 条因数据不足无法判定`
            : '全部规则均未触发'
          : `触发 ${triggered.length} 条：${triggered.map((t) => t.id).join('、')}` +
            (unknown.length ? `；另有 ${unknown.length} 条无法判定` : ''),
    ruleBasis: '演示用虚构阈值，不代表行内正式授信政策',
  };
}
