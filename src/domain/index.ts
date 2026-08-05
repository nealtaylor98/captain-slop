export type ProviderName = "codex" | "claude" | "fake" | string;
export type ToolName = string;

export interface AgentProfile {
  id: string;
  provider: ProviderName;
  model: string;
  instructions: string;
  allowedTools: ToolName[];
}

export type AgentStatus = "queued" | "running" | "waiting-for-approval" | "completed" | "failed" | "cancelled";
export type AgentRole = "main" | "worker";

export interface AgentInstance {
  id: string;
  sessionId: string;
  profileId: string;
  role: AgentRole;
  ordinal: number;
  status: AgentStatus;
  task: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  runtimeSessionId?: string;
}

export interface WorkerReport {
  workerId: string;
  status: Extract<AgentStatus, "completed" | "failed" | "cancelled">;
  summary: string;
  artifacts: string[];
  changes: string[];
  suggestedNextStep?: string;
  escalationRequest?: string;
}

export interface ApprovalRequest {
  id: string;
  requestedBy: string;
  tool: ToolName;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}

export interface PolicyProposal extends ApprovalRequest { scope: "global" | `profile:${string}`; }

/** Holds proposed policy changes separately so an agent cannot self-approve them. */
export class PolicyManager {
  private readonly global = new Set<ToolName>();
  private readonly pending = new Map<string, PolicyProposal>();
  constructor(globalTools: ToolName[]) { for (const tool of globalTools) this.global.add(tool); }
  globalTools(): ReadonlySet<ToolName> { return this.global; }
  propose(requestedBy: string, scope: PolicyProposal["scope"], tool: ToolName, reason: string): PolicyProposal {
    const proposal = { ...requestPolicyChange(requestedBy, tool, reason), scope };
    this.pending.set(proposal.id, proposal); return proposal;
  }
  confirm(id: string): PolicyProposal {
    const proposal = this.pending.get(id);
    if (!proposal) throw new Error(`Unknown policy proposal: ${id}`);
    proposal.status = "approved";
    if (proposal.scope === "global") this.global.add(proposal.tool);
    this.pending.delete(id); return proposal;
  }
  reject(id: string): PolicyProposal {
    const proposal = this.pending.get(id);
    if (!proposal) throw new Error(`Unknown policy proposal: ${id}`);
    proposal.status = "rejected"; this.pending.delete(id); return proposal;
  }
}

const transitions: Record<AgentStatus, AgentStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["waiting-for-approval", "completed", "failed", "cancelled"],
  "waiting-for-approval": ["running", "failed", "cancelled"],
  completed: [], failed: [], cancelled: []
};

export function transitionStatus(current: AgentStatus, next: AgentStatus): AgentStatus {
  if (!transitions[current].includes(next)) throw new Error(`Invalid status transition: ${current} -> ${next}`);
  return next;
}

export function effectiveTools(baseline: ToolName[], profileGrants: ToolName[], approvedTaskGrants: ToolName[]): Set<ToolName> {
  return new Set([...baseline, ...profileGrants, ...approvedTaskGrants]);
}

export function requestPolicyChange(requestedBy: string, tool: ToolName, reason: string): ApprovalRequest {
  return { id: `approval-${requestedBy}-${tool}-${Date.now()}`, requestedBy, tool, reason, status: "pending", createdAt: Date.now() };
}

export function canUseTool(tool: ToolName, baseline: ToolName[], profileGrants: ToolName[], approvedTaskGrants: ToolName[]): boolean {
  return effectiveTools(baseline, profileGrants, approvedTaskGrants).has(tool);
}
