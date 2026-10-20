import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';

const DB_PATH = path.join(DATA_DIR, 'demo-db.json');

/**
 * 演示数据设计原则（对应概要需求 6.1）：
 * 全部为虚构数据，仅两家企业、两年财务、一套教学用风险提示规则。
 * 数据带版本号，每次运行记录版本，保证前后对比有共同基准。
 */
export const SEED = {
  version: 'demo-2026.10-v1',
  note: '本库所有企业与财务数据均为教学虚构数据，不代表任何真实客户信息。',
  companies: [
    {
      company_id: 'DEMO001',
      name: '星河科技有限公司（虚构）',
      registered_capital: 5000,
      capital_unit: '万元',
      status: '存续',
      established: '2016-04-12',
      industry: '软件和信息技术服务业',
      source: '本地演示工商库',
      updated_at: '2026-03-31',
      financials: [
        { year: 2024, revenue: 1000, total_assets: 900, total_liabilities: 600, operating_cash_flow: 40, unit: '万元' },
        { year: 2025, revenue: 800, total_assets: 1000, total_liabilities: 750, operating_cash_flow: -100, unit: '万元' },
      ],
    },
    {
      company_id: 'DEMO002',
      name: '晨光制造有限公司（虚构）',
      registered_capital: 3000,
      capital_unit: '万元',
      status: '存续',
      established: '2011-09-08',
      industry: '通用设备制造业',
      source: '本地演示工商库',
      updated_at: '2026-03-31',
      financials: [
        { year: 2024, revenue: 1000, total_assets: 950, total_liabilities: 420, operating_cash_flow: 120, unit: '万元' },
        { year: 2025, revenue: 1200, total_assets: 1000, total_liabilities: 400, operating_cash_flow: 150, unit: '万元' },
      ],
    },
  ],
  /** 教学用规则，非银行真实审查政策 */
  rules: [
    { id: 'R01', name: '偿债压力关注', condition: '资产负债率 > 70%', metric: 'debt_ratio', op: 'gt', threshold: 70, hint: '提示关注偿债压力' },
    { id: 'R02', name: '经营变化关注', condition: '营业收入同比下降 > 15%', metric: 'revenue_yoy', op: 'lt', threshold: -15, hint: '提示关注经营变化' },
    { id: 'R03', name: '现金流关注', condition: '经营活动现金流净额 < 0', metric: 'operating_cash_flow', op: 'lt', threshold: 0, hint: '提示关注现金流' },
  ],
};

export function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(SEED, null, 2), 'utf8');
  }
}

export function readDb() {
  ensureDb();
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return structuredClone(SEED);
  }
}

export function resetDb() {
  ensureDb();
  fs.writeFileSync(DB_PATH, JSON.stringify(SEED, null, 2), 'utf8');
  return readDb();
}

export function findCompany(idOrName) {
  const db = readDb();
  const q = String(idOrName || '').trim();
  if (!q) return null;
  return (
    db.companies.find((c) => c.company_id.toLowerCase() === q.toLowerCase()) ||
    db.companies.find((c) => c.name.includes(q) || q.includes(c.name.replace('（虚构）', ''))) ||
    null
  );
}

export function findFinancials(idOrName, year) {
  const company = findCompany(idOrName);
  if (!company) return null;
  const rows = year
    ? company.financials.filter((f) => Number(f.year) === Number(year))
    : company.financials;
  return { company, rows };
}

/**
 * 确定性指标计算：不经过模型，全部由程序算。
 * 对应需求 5.8：规则是否触发必须由确定性程序判定。
 */
export function computeMetrics(company) {
  const fs2 = [...company.financials].sort((a, b) => a.year - b.year);
  const latest = fs2[fs2.length - 1];
  const prev = fs2[fs2.length - 2];
  const out = {
    company_id: company.company_id,
    company_name: company.name,
    year: latest.year,
    revenue: latest.revenue,
    revenue_prev: prev ? prev.revenue : null,
    total_assets: latest.total_assets,
    total_liabilities: latest.total_liabilities,
    operating_cash_flow: latest.operating_cash_flow,
    unit: latest.unit,
    debt_ratio: round2((latest.total_liabilities / latest.total_assets) * 100),
    revenue_yoy: prev && prev.revenue ? round2(((latest.revenue - prev.revenue) / prev.revenue) * 100) : null,
  };
  return out;
}

export function runRules(metrics) {
  const db = readDb();
  return db.rules.map((rule) => {
    const value = metrics[rule.metric];
    let triggered = false;
    if (value !== null && value !== undefined) {
      triggered = rule.op === 'gt' ? value > rule.threshold : value < rule.threshold;
    }
    return { ...rule, value, triggered };
  });
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
