export type NodeStatus = 'idle' | 'running' | 'success' | 'error' | 'rejected' | 'skipped';

export interface ArchNode {
  id: string;
  label: string;
  sub?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tone: 'core' | 'model' | 'capability' | 'resource' | 'data' | 'guard';
  status?: NodeStatus;
  badge?: string;
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
  kind: 'request' | 'response' | 'data' | 'context' | 'control';
  label?: string;
  dashed?: boolean;
  active?: boolean;
  degraded?: boolean;
}

export interface RunEvent {
  run_id: string;
  event_id: string;
  sequence: number;
  timestamp: string;
  event_type: string;
  component_id: string;
  payload: any;
  status: string;
}

export interface ToolConfig {
  functionCalling: boolean;
  tools: string[];
  mcpMode: boolean;
}

export interface RunConfig {
  chapter: string;
  chapterTitle?: string;
  modelLabel?: string;
  systemPrompt: { enabled: boolean; text: string };
  multiTurn: boolean;
  temperature: number;
  functionCalling: boolean;
  tools: string[];
  mcpMode: boolean;
  rag: boolean;
  ragMode?: 'lexical' | 'vector' | 'hybrid';
  topK: number;
  skill: string | null;
  skillAuto: boolean;
  maxToolRounds: number;
}

export interface RunSummary {
  runId: string;
  chapter: string;
  chapterTitle: string;
  question: string;
  status: string;
  createdAt: number;
  durationMs: number | null;
  llmCalls: number | null;
  toolCalls: number | null;
  answer: string;
  snapshot: any;
  error: string | null;
  eventCount: number;
}

export interface Chapter {
  id: string;
  no: string;
  title: string;
  question: string;
  placeholder?: string;
  preset: Partial<RunConfig>;
  locked?: boolean;
}
