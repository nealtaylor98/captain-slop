import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type {
  AgentEvent,
  AgentRuntime,
  RuntimeCapabilities,
  RuntimeSession,
  SessionOptions,
} from "./types.js";
import type { ToolName } from "../domain/index.js";

export interface CodexProcess {
  completed: Promise<{ exitCode: number; stderr: string }>;
  kill(): void;
}

/** Thin seam around the installed Codex CLI; tests use this instead of a real child process. */
export interface CodexCli {
  start(args: string[], onLine: (line: string) => void): CodexProcess;
}

class LocalCodexCli implements CodexCli {
  constructor(private readonly command: string) {}
  start(args: string[], onLine: (line: string) => void): CodexProcess {
    const child = spawn(this.command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", onLine);
    const completed = new Promise<{ exitCode: number; stderr: string }>((resolve) => {
      child.once("error", (error) => resolve({ exitCode: 1, stderr: error.message }));
      child.once("close", (code) => resolve({ exitCode: code ?? 1, stderr }));
    });
    return {
      completed,
      kill: () => {
        if (!child.killed) child.kill("SIGTERM");
      },
    };
  }
}

interface SessionState {
  nativeId?: string;
  model: string;
  profileInstructions: string;
  allowedTools: ToolName[];
  process?: CodexProcess;
  cancelled: boolean;
  rolloutStop?: () => void;
  onRuntimeEvent?: (event: AgentEvent) => void;
}
export interface CodexRolloutObserver {
  observe(threadId: string, onLine: (line: string) => void): () => void;
}
export interface CodexRuntimeOptions {
  cli?: CodexCli;
  command?: string;
  cwd?: string;
  model?: string;
  rolloutObserver?: CodexRolloutObserver;
}

class LocalCodexRolloutObserver implements CodexRolloutObserver {
  constructor(
    private readonly root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "sessions"),
  ) {}
  observe(threadId: string, onLine: (line: string) => void): () => void {
    let stopped = false;
    let busy = false;
    let path: string | undefined;
    let lineCount = 0;
    const poll = async (): Promise<void> => {
      if (stopped || busy) return;
      busy = true;
      try {
        if (!path) {
          const entries = await readdir(this.root, { recursive: true });
          const match = entries.find((entry) => entry.endsWith(`${threadId}.jsonl`));
          if (match) path = join(this.root, match);
        }
        if (path) {
          const lines = (await readFile(path, "utf8")).split("\n").filter(Boolean);
          for (const line of lines.slice(lineCount)) onLine(line);
          lineCount = lines.length;
        }
      } catch {
        /* The rollout may not exist until just after thread.started. */
      } finally {
        busy = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 100);
    timer.unref();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }
}

export function codexWorkerEventFromRolloutLine(line: string): AgentEvent | undefined {
  try {
    const record = JSON.parse(line) as {
      type?: string;
      payload?: {
        type?: string;
        agent_thread_id?: string;
        agent_path?: string;
        kind?: string;
        occurred_at_ms?: number;
      };
    };
    const payload = record.payload;
    if (
      record.type !== "event_msg" ||
      payload?.type !== "sub_agent_activity" ||
      payload.kind !== "started" ||
      !payload.agent_thread_id ||
      !payload.agent_path
    )
      return undefined;
    return {
      type: "worker-started",
      workerId: payload.agent_thread_id,
      name: payload.agent_path.split("/").filter(Boolean).at(-1) ?? "worker",
      startedAt: payload.occurred_at_ms ?? Date.now(),
    };
  } catch {
    return undefined;
  }
}

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(value: T) => void> = [];
  push(value: T): void {
    const reader = this.readers.shift();
    if (reader) reader(value);
    else this.values.push(value);
  }
  next(): Promise<T> {
    const value = this.values.shift();
    return value === undefined
      ? new Promise((resolve) => this.readers.push(resolve))
      : Promise.resolve(value);
  }
}

/**
 * Adapter for a locally installed and already-authenticated `codex` CLI. It does
 * not configure credentials and intentionally never opts into dangerous bypasses.
 */
export class CodexRuntime implements AgentRuntime {
  private nextId = 1;
  private readonly states = new Map<string, SessionState>();
  private readonly cli: CodexCli;
  private readonly cwd: string;
  private readonly defaultModel: string;
  private readonly rolloutObserver: CodexRolloutObserver;

  constructor(options: CodexRuntimeOptions = {}) {
    this.cli = options.cli ?? new LocalCodexCli(options.command ?? "codex");
    this.cwd = options.cwd ?? process.cwd();
    this.defaultModel = options.model ?? "";
    this.rolloutObserver = options.rolloutObserver ?? new LocalCodexRolloutObserver();
  }

  capabilities(): RuntimeCapabilities {
    return {
      enforcedTools: false,
      limitations: [
        "Codex CLI sandboxing is mapped coarsely (read-only or workspace-write); captain-slop cannot enforce individual allowedTools grants.",
      ],
    };
  }

  async createSession(options: SessionOptions): Promise<RuntimeSession> {
    const id = `codex-pending-${this.nextId++}`;
    this.states.set(id, {
      model: options.profile.model,
      profileInstructions: options.profile.instructions,
      allowedTools: options.allowedTools ?? options.profile.allowedTools,
      cancelled: false,
    });
    return { id, agentId: options.agentId };
  }

  async resumeSession(id: string): Promise<RuntimeSession> {
    if (!this.states.has(id))
      this.states.set(id, {
        nativeId: id,
        model: this.defaultModel,
        profileInstructions: "",
        allowedTools: [],
        cancelled: false,
      });
    return { id, agentId: "resumed" };
  }

  async *send(session: RuntimeSession, message: string): AsyncIterable<AgentEvent> {
    const state = this.stateFor(session);
    if (state.process) throw new Error(`Codex session ${session.id} already has an active turn.`);
    state.cancelled = false;
    const modelArgs = state.model ? ["--model", state.model] : [];
    const args = state.nativeId
      ? ["exec", "resume", state.nativeId, "--json", ...modelArgs, message]
      : [
          "exec",
          "--json",
          ...modelArgs,
          "--sandbox",
          this.sandboxFor(state),
          "--cd",
          this.cwd,
          this.prompt(state.profileInstructions, message),
        ];
    const queue = new AsyncQueue<
      AgentEvent | { processResult: { exitCode: number; stderr: string } }
    >();
    state.onRuntimeEvent = (event) => queue.push(event);
    const process = this.cli.start(args, (line) => {
      const events: AgentEvent[] = [];
      this.mapLine(line, session, state, events);
      for (const event of events) queue.push(event);
    });
    state.process = process;
    void process.completed.then((processResult) => queue.push({ processResult }));
    try {
      while (true) {
        const next = await queue.next();
        if ("processResult" in next) {
          const result = next.processResult;
          if (!state.cancelled && result.exitCode !== 0)
            yield {
              type: "failed",
              message: result.stderr.trim() || `Codex CLI exited with code ${result.exitCode}.`,
            };
          return;
        }
        yield next;
      }
    } finally {
      state.rolloutStop?.();
      state.rolloutStop = undefined;
      state.onRuntimeEvent = undefined;
      if (state.process === process) state.process = undefined;
    }
  }

  async cancel(session: RuntimeSession): Promise<void> {
    const state = this.stateFor(session);
    state.cancelled = true;
    state.process?.kill();
  }

  private stateFor(session: RuntimeSession): SessionState {
    const state = this.states.get(session.id);
    if (!state) throw new Error(`Unknown Codex session: ${session.id}`);
    return state;
  }

  private sandboxFor(state: SessionState): string {
    return state.allowedTools.includes("workspace_write") ? "workspace-write" : "read-only";
  }
  private prompt(instructions: string, message: string): string {
    return instructions ? `${instructions}\n\n${message}` : message;
  }

  private mapLine(
    line: string,
    session: RuntimeSession,
    state: SessionState,
    events: AgentEvent[],
  ): void {
    let event: {
      type?: string;
      thread_id?: string;
      item?: Record<string, unknown>;
      usage?: unknown;
      error?: unknown;
    };
    try {
      event = JSON.parse(line) as typeof event;
    } catch {
      events.push({ type: "warning", message: `Ignoring non-JSON Codex output: ${line}` });
      return;
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      const oldId = session.id;
      state.nativeId = event.thread_id;
      session.id = event.thread_id;
      this.states.delete(oldId);
      this.states.set(session.id, state);
      state.rolloutStop?.();
      state.rolloutStop = this.rolloutObserver.observe(session.id, (line) => {
        const workerEvent = codexWorkerEventFromRolloutLine(line);
        if (workerEvent) state.onRuntimeEvent?.(workerEvent);
      });
      events.push({ type: "activity", message: "Codex session started." });
      return;
    }
    if (event.type === "item.completed" || event.type === "item.started") {
      const item = event.item ?? {};
      const itemType = item.type;
      if (
        itemType === "agent_message" &&
        event.type === "item.completed" &&
        typeof item.text === "string"
      )
        events.push({ type: "text", text: item.text });
      if (itemType === "reasoning")
        events.push({
          type: "activity",
          message:
            event.type === "item.started" ? "Codex is reasoning." : "Codex finished reasoning.",
        });
      if (itemType === "command_execution") {
        const command = typeof item.command === "string" ? item.command : "shell command";
        if (event.type === "item.started") events.push({ type: "tool-started", tool: "shell" });
        else {
          events.push({ type: "tool-started", tool: "shell" });
          events.push({
            type: "tool-finished",
            tool: "shell",
            result: typeof item.aggregated_output === "string" ? item.aggregated_output : command,
          });
        }
      }
      return;
    }
    if (event.type === "turn.completed") {
      events.push(
        { type: "activity", message: "Codex turn completed." },
        { type: "completed", summary: "Codex completed the turn." },
      );
      return;
    }
    if (event.type === "turn.failed" || event.type === "error")
      events.push({
        type: "failed",
        message: typeof event.error === "string" ? event.error : "Codex turn failed.",
      });
  }
}
