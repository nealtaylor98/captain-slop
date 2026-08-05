import type { WorkerReport } from "../domain/index.js";
import type { AgentEvent } from "../runtimes/types.js";

export interface StoredSession { id: string; createdAt: number; updatedAt: number; mainAgentId: string; compaction?: { compactedAt: number; summary: string }; }
export interface StoredEvent { at: number; agentId: string; event: AgentEvent; }
export interface Persistence {
  open(): Promise<void>;
  saveSession(session: StoredSession): Promise<void>;
  appendEvent(sessionId: string, event: StoredEvent): Promise<void>;
  saveReport(report: WorkerReport): Promise<void>;
  cleanup(now: number): Promise<number>;
}
