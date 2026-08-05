import type { AgentProfile, ToolName } from "../domain/index.js";

export type AgentEvent =
  | { type: "user-message"; text: string }
  | { type: "text"; text: string }
  | { type: "activity"; message: string }
  | { type: "tool-requested"; tool: ToolName; reason: string }
  | { type: "tool-started"; tool: ToolName }
  | { type: "tool-finished"; tool: ToolName; result: string }
  | { type: "approval-needed"; tool: ToolName; reason: string }
  | { type: "warning"; message: string }
  | { type: "worker-started"; workerId: string; name: string; startedAt: number }
  | { type: "worker-event"; workerId: string; event: WorkerAgentEvent }
  | {
      type: "completed";
      summary: string;
      artifacts?: string[];
      changes?: string[];
      suggestedNextStep?: string;
    }
  | { type: "failed"; message: string };

export type WorkerAgentEvent =
  | { type: "text"; text: string }
  | { type: "activity"; message: string }
  | { type: "tool-requested"; tool: ToolName; reason: string }
  | { type: "tool-started"; tool: ToolName }
  | { type: "tool-finished"; tool: ToolName; result: string }
  | { type: "warning"; message: string }
  | {
      type: "completed";
      summary: string;
      artifacts?: string[];
      changes?: string[];
      suggestedNextStep?: string;
    }
  | { type: "failed"; message: string };

export interface RuntimeSession {
  id: string;
  agentId: string;
}
export interface RuntimeCapabilities {
  enforcedTools: boolean;
  limitations: string[];
}
export interface SessionOptions {
  agentId: string;
  profile: AgentProfile;
  allowedTools?: ToolName[];
}
export interface AgentRuntime {
  createSession(options: SessionOptions): Promise<RuntimeSession>;
  resumeSession(id: string): Promise<RuntimeSession>;
  send(session: RuntimeSession, message: string): AsyncIterable<AgentEvent>;
  cancel(session: RuntimeSession): Promise<void>;
  capabilities(): RuntimeCapabilities;
}
