import { randomUUID } from "node:crypto";
import type { AgentProfile } from "../domain/index.js";
import type { AgentEvent, AgentRuntime } from "../runtimes/types.js";
import type { Persistence, StoredSession } from "../storage/types.js";
import { MainAgentController } from "./controller.js";

const DAY_MS = 24 * 60 * 60 * 1000;
type Clock = () => number;
type IntervalScheduler = (callback: () => void, delay: number) => NodeJS.Timeout;

export class MainSession {
  private readonly controller: MainAgentController;

  private constructor(
    private readonly persistence: Persistence,
    private readonly stored: StoredSession,
    runtime: AgentRuntime,
    profile: AgentProfile,
    private readonly clock: Clock,
    private readonly onEvent?: (event: AgentEvent) => unknown | Promise<unknown>,
  ) {
    this.controller = new MainAgentController(
      runtime,
      profile,
      async (event) => {
        await this.record(event);
        await this.onEvent?.(event);
      },
      stored.runtimeSessionId,
      async (runtimeSessionId) => {
        this.stored.runtimeSessionId = runtimeSessionId;
        this.stored.updatedAt = this.clock();
        await this.persistence.saveSession(this.stored);
      },
    );
  }

  static async open(
    persistence: Persistence,
    runtime: AgentRuntime,
    profile: AgentProfile,
    clock: Clock = Date.now,
    onEvent?: (event: AgentEvent) => unknown | Promise<unknown>,
  ): Promise<MainSession> {
    let stored = persistence.latestSession();
    if (!stored) {
      const now = clock();
      stored = { id: randomUUID(), createdAt: now, updatedAt: now, mainAgentId: "main" };
      await persistence.saveSession(stored);
    }
    return new MainSession(persistence, stored, runtime, profile, clock, onEvent);
  }

  static async startRetention(
    persistence: Pick<Persistence, "cleanup">,
    clock: Clock = Date.now,
    schedule: IntervalScheduler = setInterval,
  ): Promise<NodeJS.Timeout> {
    await persistence.cleanup(clock());
    const timer = schedule(() => {
      void persistence.cleanup(clock());
    }, DAY_MS);
    timer.unref();
    return timer;
  }

  transcript(): string[] {
    const lines = this.stored.compaction
      ? [`Conversation summary: ${this.stored.compaction.summary}`]
      : [];
    for (const { event } of this.persistence.events(this.stored.id)) {
      const line = transcriptLine(event);
      if (line) lines.push(line);
    }
    return lines;
  }

  workerEvents(): AgentEvent[] {
    return this.persistence
      .events(this.stored.id)
      .map(({ event }) => event)
      .filter((event) => event.type === "worker-started" || event.type === "worker-event");
  }

  async send(message: string): Promise<void> {
    await this.record({ type: "user-message", text: message });
    await this.controller.send(message);
  }

  private async record(event: AgentEvent): Promise<void> {
    const at = this.clock();
    const agentId =
      event.type === "worker-started" || event.type === "worker-event" ? event.workerId : "main";
    await this.persistence.appendEvent(this.stored.id, { at, agentId, event });
    this.stored.updatedAt = at;
    await this.persistence.saveSession(this.stored);
  }
}

export function transcriptLine(event: AgentEvent): string | undefined {
  if (event.type === "user-message") return `You: ${event.text}`;
  if (event.type === "text") return `Assistant: ${event.text}`;
  if (event.type === "failed") return `Assistant error: ${event.message}`;
  return undefined;
}
