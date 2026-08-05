import {
  type AgentInstance,
  type AgentProfile,
  type AgentStatus,
  type ToolName,
  type WorkerReport,
  transitionStatus,
} from "./index.js";
import type { AgentEvent, AgentRuntime } from "../runtimes/types.js";

export interface SchedulerOptions {
  runtimes: Map<string, AgentRuntime>;
  profiles: AgentProfile[];
  globalTools: ToolName[];
  concurrency: number;
  onReport?: (report: WorkerReport) => void;
}

export class WorkerScheduler {
  private readonly profiles = new Map<string, AgentProfile>();
  private readonly items: AgentInstance[] = [];
  private readonly completedReports: WorkerReport[] = [];
  private readonly eventsByWorker = new Map<string, AgentEvent[]>();
  private active = 0;
  private readonly running = new Set<Promise<void>>();
  constructor(private readonly options: SchedulerOptions) {
    for (const profile of options.profiles) this.profiles.set(profile.id, profile);
  }
  spawn(sessionId: string, profileId: string, task: string): AgentInstance {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Unknown profile: ${profileId}`);
    const ordinal = this.items.filter((item) => item.profileId === profileId).length + 1;
    const item: AgentInstance = {
      id: `worker-${this.items.length + 1}`,
      sessionId,
      profileId,
      role: "worker",
      ordinal,
      status: "queued",
      task,
      createdAt: Date.now(),
    };
    this.items.push(item);
    this.eventsByWorker.set(item.id, []);
    this.drain();
    return item;
  }
  workers(): readonly AgentInstance[] {
    return this.items;
  }
  reports(): readonly WorkerReport[] {
    return this.completedReports;
  }
  events(workerId: string): readonly AgentEvent[] {
    return this.eventsByWorker.get(workerId) ?? [];
  }
  cancel(workerId: string): void {
    const item = this.items.find((worker) => worker.id === workerId);
    if (
      !item ||
      item.status === "completed" ||
      item.status === "failed" ||
      item.status === "cancelled"
    )
      return;
    item.status = transitionStatus(item.status, "cancelled");
    item.finishedAt = Date.now();
  }
  async idle(): Promise<void> {
    await Promise.all([...this.running]);
  }
  private drain(): void {
    while (this.active < this.options.concurrency) {
      const item = this.items.find((worker) => worker.status === "queued");
      if (!item) return;
      this.active++;
      const task = this.run(item).finally(() => {
        this.active--;
        this.running.delete(task);
        this.drain();
      });
      this.running.add(task);
    }
  }
  private async run(item: AgentInstance): Promise<void> {
    if (item.status === "cancelled") return;
    const profile = this.profiles.get(item.profileId)!;
    const runtime = this.options.runtimes.get(profile.provider);
    if (!runtime) {
      item.status = transitionStatus(item.status, "cancelled");
      return;
    }
    try {
      item.status = transitionStatus(item.status, "running");
      item.startedAt = Date.now();
      const session = await runtime.createSession({
        agentId: item.id,
        profile,
        allowedTools: [...this.options.globalTools, ...profile.allowedTools],
      });
      item.runtimeSessionId = session.id;
      for await (const event of runtime.send(session, item.task)) {
        item.runtimeSessionId = session.id;
        if (item.status === "cancelled") {
          await runtime.cancel(session);
          return;
        }
        this.eventsByWorker.get(item.id)!.push(event);
        if (event.type === "approval-needed")
          item.status = transitionStatus(item.status, "waiting-for-approval");
        if (event.type === "completed")
          this.finish(
            item,
            "completed",
            event.summary,
            event.artifacts,
            event.changes,
            event.suggestedNextStep,
          );
        if (event.type === "failed") this.finish(item, "failed", event.message);
      }
      item.runtimeSessionId = session.id;
      if (item.status === "running")
        this.finish(item, "completed", "Worker finished without a report.");
    } catch (error) {
      if (item.status !== "cancelled")
        this.finish(item, "failed", error instanceof Error ? error.message : String(error));
    }
  }
  private finish(
    item: AgentInstance,
    status: Extract<AgentStatus, "completed" | "failed">,
    summary: string,
    artifacts: string[] = [],
    changes: string[] = [],
    suggestedNextStep?: string,
  ): void {
    if (item.status === "completed" || item.status === "failed" || item.status === "cancelled")
      return;
    item.status = transitionStatus(item.status, status);
    item.finishedAt = Date.now();
    const report = { workerId: item.id, status, summary, artifacts, changes, suggestedNextStep };
    this.completedReports.push(report);
    this.options.onReport?.(report);
  }
}
