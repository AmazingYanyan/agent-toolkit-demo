import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.mjs';

const RUNS_PATH = path.join(DATA_DIR, 'runs.json');
const MAX_RUNS = 60;

let runs = new Map();

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(RUNS_PATH)) return;
  try {
    const arr = JSON.parse(fs.readFileSync(RUNS_PATH, 'utf8'));
    runs = new Map(arr.map((r) => [r.runId, r]));
  } catch {
    runs = new Map();
  }
}
load();

function persist() {
  const arr = [...runs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RUNS);
  fs.writeFileSync(RUNS_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

export function createRun({ runId, chapter, chapterTitle, question, snapshot }) {
  const run = {
    runId,
    chapter,
    chapterTitle,
    question,
    snapshot,
    status: 'running',
    createdAt: Date.now(),
    events: [],
    answer: '',
    stats: null,
    error: null,
  };
  runs.set(runId, run);
  return run;
}

export function appendEvent(runId, evt) {
  const run = runs.get(runId);
  if (!run) return;
  // 流式增量事件不入库，避免体积极大；只保留首尾用于回放
  if (evt.event_type === 'llm_output_delta') {
    run.events.push({ ...evt, payload: { text: evt.payload.text } });
    return;
  }
  run.events.push(evt);
}

export function finishRun(runId, patch) {
  const run = runs.get(runId);
  if (!run) return;
  Object.assign(run, patch);
  persist();
}

export function getRun(runId) {
  return runs.get(runId) || null;
}

export function listRuns(limit = 30) {
  return [...runs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((r) => ({
      runId: r.runId,
      chapter: r.chapter,
      chapterTitle: r.chapterTitle,
      question: r.question,
      status: r.status,
      createdAt: r.createdAt,
      durationMs: r.stats?.durationMs ?? null,
      llmCalls: r.stats?.llmCalls ?? null,
      toolCalls: r.stats?.toolCalls ?? null,
      answer: r.answer,
      snapshot: r.snapshot,
      error: r.error,
      eventCount: r.events.length,
    }));
}

export function clearRuns() {
  runs = new Map();
  persist();
}
