import type { WorkerReport } from "../domain/index.js";
import type { AgentEvent } from "../runtimes/types.js";

export interface StoredSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  mainAgentId: string;
  runtimeSessionId?: string;
  compaction?: { compactedAt: number; summary: string };
}
export interface StoredEvent {
  at: number;
  agentId: string;
  event: AgentEvent;
}
export interface Persistence {
  open(): Promise<void>;
  latestSession(): StoredSession | undefined;
  events(sessionId: string): readonly StoredEvent[];
  saveSession(session: StoredSession): Promise<void>;
  appendEvent(sessionId: string, event: StoredEvent): Promise<void>;
  compactSession(sessionId: string, summary: string, compactedAt: number): Promise<void>;
  saveReport(report: WorkerReport): Promise<void>;
  cleanup(now: number): Promise<number>;
}
