import { randomUUID } from "node:crypto";
import type { AgentProfile } from "../domain/index.js";
import type { TranscriptEntry } from "../domain/transcript.js";
import type { AgentEvent, AgentRuntime } from "../runtimes/types.js";
import type { Persistence, StoredSession } from "../storage/types.js";
import { MainAgentController } from "./controller.js";
import { correlationId, type LogContext } from "../observability/logger.js";

const DAY_MS = 24 * 60 * 60 * 1000;
type Clock = () => number;
type IntervalScheduler = (callback: () => void, delay: number) => NodeJS.Timeout;
interface LogSink {
  info(component: string, event: string, context?: LogContext, data?: unknown): Promise<void>;
  error(component: string, event: string, context?: LogContext, data?: unknown): Promise<void>;
  debug(component: string, event: string, context?: LogContext, data?: unknown): Promise<void>;
}

export class MainSession {
  private readonly controller: MainAgentController;
  private activeLogContext?: LogContext;

  private constructor(
    private readonly persistence: Persistence,
    private readonly stored: StoredSession,
    runtime: AgentRuntime,
    profile: AgentProfile,
    private readonly clock: Clock,
    private readonly onEvent?: (event: AgentEvent) => unknown | Promise<unknown>,
    private readonly logger?: LogSink,
  ) {
    this.controller = new MainAgentController(
      runtime,
      profile,
      async (event) => {
        await this.record(event, this.activeLogContext);
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
    logger?: LogSink,
  ): Promise<MainSession> {
    let stored = persistence.latestSession();
    if (!stored) {
      const now = clock();
      stored = { id: randomUUID(), createdAt: now, updatedAt: now, mainAgentId: "main" };
      await persistence.saveSession(stored);
    }
    return new MainSession(persistence, stored, runtime, profile, clock, onEvent, logger);
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

  transcript(): TranscriptEntry[] {
    const lines: TranscriptEntry[] = this.stored.compaction
      ? [{ kind: "status", text: `Conversation summary: ${this.stored.compaction.summary}` }]
      : [];
    for (const { event } of this.persistence.events(this.stored.id)) {
      const line = transcriptLine(event);
      if (line) lines.push(line);
    }
    return lines;
  }

  async send(message: string): Promise<void> {
    const context: LogContext = {
      appSessionId: this.stored.id,
      agentId: "main",
      turnId: randomUUID(),
      correlationId: correlationId(),
    };
    await this.logger?.info("main-turn", "turn.started", context);
    this.activeLogContext = context;
    try {
      await this.record({ type: "user-message", text: message }, context);
      await this.controller.send(message);
      context.runtimeSessionId = this.controller.runtimeSessionId();
      await this.logger?.info("main-turn", "turn.completed", context);
    } catch (error) {
      context.runtimeSessionId = this.controller.runtimeSessionId();
      await this.logger?.error("main-turn", "turn.failed", context, {
        errorType: error instanceof Error ? error.name : "UnknownError",
      });
      throw error;
    } finally {
      this.activeLogContext = undefined;
    }
  }

  private async record(event: AgentEvent, context?: LogContext): Promise<void> {
    const at = this.clock();
    await this.persistence.appendEvent(this.stored.id, { at, agentId: "main", event });
    this.stored.updatedAt = at;
    await this.persistence.saveSession(this.stored);
    await this.logger?.debug(
      "persistence",
      "event.appended",
      {
        appSessionId: this.stored.id,
        agentId: "main",
        runtimeSessionId: this.controller.runtimeSessionId(),
        ...context,
      },
      { eventType: event.type },
    );
  }
}

export function transcriptLine(event: AgentEvent): TranscriptEntry | undefined {
  if (event.type === "user-message") return { kind: "user", text: event.text };
  if (event.type === "text") return { kind: "agent", text: event.text };
  if (event.type === "failed") return { kind: "status", text: `Error: ${event.message}` };
  return undefined;
}
