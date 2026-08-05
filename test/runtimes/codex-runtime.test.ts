import assert from "node:assert/strict";
import test from "node:test";
import {
  CodexRuntime,
  codexWorkerEventFromRolloutLine,
  type CodexCli,
  type CodexProcess,
  type CodexRolloutObserver,
} from "../../src/runtimes/codex-runtime.js";

class FakeCodexCli implements CodexCli {
  readonly calls: string[][] = [];
  readonly processes: FakeCodexProcess[] = [];
  start(args: string[], onLine: (line: string) => void): CodexProcess {
    this.calls.push(args);
    const process = new FakeCodexProcess(onLine);
    this.processes.push(process);
    return process;
  }
}

class FakeCodexProcess implements CodexProcess {
  killed = false;
  private resolve!: (result: { exitCode: number; stderr: string }) => void;
  readonly completed = new Promise<{ exitCode: number; stderr: string }>((resolve) => {
    this.resolve = resolve;
  });
  constructor(private readonly onLine: (line: string) => void) {}
  emit(event: unknown): void {
    this.onLine(JSON.stringify(event));
  }
  finish(exitCode = 0, stderr = ""): void {
    this.resolve({ exitCode, stderr });
  }
  kill(): void {
    this.killed = true;
    this.finish(143);
  }
}

const profile = {
  id: "builder",
  provider: "codex",
  model: "gpt-5.6",
  instructions: "Make scoped changes.",
  allowedTools: ["workspace_write"],
};

test("Codex runtime starts the local JSON CLI, captures its native session id, and normalizes streamed events", async () => {
  const cli = new FakeCodexCli();
  const runtime = new CodexRuntime({ cli, cwd: "/workspace" });
  const session = await runtime.createSession({ agentId: "a", profile });
  const events: string[] = [];
  const sending = (async () => {
    for await (const event of runtime.send(session, "fix it")) events.push(event.type);
  })();
  const process = cli.processes[0];
  assert.deepEqual(cli.calls[0], [
    "exec",
    "--json",
    "--model",
    "gpt-5.6",
    "--sandbox",
    "workspace-write",
    "--cd",
    "/workspace",
    "Make scoped changes.\n\nfix it",
  ]);
  process.emit({ type: "thread.started", thread_id: "native-thread" });
  process.emit({ type: "item.completed", item: { type: "agent_message", text: "I fixed it." } });
  process.emit({
    type: "item.completed",
    item: { type: "command_execution", command: "npm test", aggregated_output: "ok", exit_code: 0 },
  });
  process.emit({ type: "turn.completed", usage: { input_tokens: 2, output_tokens: 3 } });
  process.finish();
  await sending;
  assert.equal(session.id, "native-thread");
  assert.deepEqual(events, [
    "activity",
    "text",
    "tool-started",
    "tool-finished",
    "activity",
    "completed",
  ]);
});

test("Codex runtime yields events while the CLI process is still running", async () => {
  const cli = new FakeCodexCli();
  const runtime = new CodexRuntime({ cli, cwd: "/workspace" });
  const session = await runtime.createSession({ agentId: "a", profile });
  const events = runtime.send(session, "work in the background")[Symbol.asyncIterator]();

  const first = events.next();
  cli.processes[0].emit({ type: "thread.started", thread_id: "native-thread" });

  assert.deepEqual(await first, {
    done: false,
    value: { type: "activity", message: "Codex session started." },
  });
  cli.processes[0].finish();
  await events.next();
});

test("Codex runtime normalizes native subagent starts from the local rollout", async () => {
  const observed = new Map<string, (line: string) => void>();
  const observer: CodexRolloutObserver = {
    observe: (threadId, onLine) => {
      observed.set(threadId, onLine);
      return () => undefined;
    },
  };
  const cli = new FakeCodexCli();
  const runtime = new CodexRuntime({ cli, cwd: "/workspace", rolloutObserver: observer });
  const session = await runtime.createSession({ agentId: "a", profile });
  const events = runtime.send(session, "spawn a worker")[Symbol.asyncIterator]();
  const sessionStarted = events.next();
  cli.processes[0].emit({ type: "thread.started", thread_id: "parent-thread" });
  await sessionStarted;

  const workerStarted = events.next();
  observed.get("parent-thread")?.(
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "sub_agent_activity",
        agent_thread_id: "worker-thread",
        agent_path: "/root/timer_one",
        kind: "started",
        occurred_at_ms: 123,
      },
    }),
  );
  assert.deepEqual(await workerStarted, {
    done: false,
    value: { type: "worker-started", workerId: "worker-thread", name: "timer_one", startedAt: 123 },
  });

  const progress = events.next();
  observed.get("worker-thread")?.(
    JSON.stringify({
      type: "event_msg",
      payload: { type: "agent_message", message: "5 seconds", phase: "commentary" },
    }),
  );
  assert.deepEqual(await progress, {
    done: false,
    value: {
      type: "worker-event",
      workerId: "worker-thread",
      event: { type: "text", text: "5 seconds" },
    },
  });

  const completed = events.next();
  observed.get("worker-thread")?.(
    JSON.stringify({
      type: "event_msg",
      payload: { type: "task_complete", last_agent_message: "timer done" },
    }),
  );
  assert.deepEqual(await completed, {
    done: false,
    value: {
      type: "worker-event",
      workerId: "worker-thread",
      event: { type: "completed", summary: "timer done" },
    },
  });
  cli.processes[0].finish();
  await events.next();
});

test("unrelated rollout lines are ignored", () => {
  assert.equal(
    codexWorkerEventFromRolloutLine(
      JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
    ),
    undefined,
  );
});

test("Codex runtime resumes native sessions and cancellation terminates the active CLI process", async () => {
  const cli = new FakeCodexCli();
  const runtime = new CodexRuntime({ cli, cwd: "/workspace" });
  const session = await runtime.resumeSession("native-thread");
  const sending = runtime.send(session, "continue")[Symbol.asyncIterator]();
  const next = sending.next();
  assert.deepEqual(cli.calls[0], ["exec", "resume", "native-thread", "--json", "continue"]);
  await runtime.cancel(session);
  await next;
  assert.equal(cli.processes[0].killed, true);
});

test("Codex capabilities disclose that sandboxing is coarse and cannot enforce captain-slop tool grants", () => {
  const runtime = new CodexRuntime({ cli: new FakeCodexCli() });
  assert.deepEqual(runtime.capabilities(), {
    enforcedTools: false,
    limitations: [
      "Codex CLI sandboxing is mapped coarsely (read-only or workspace-write); captain-slop cannot enforce individual allowedTools grants.",
      "Native child progress is available only after Codex records it in the child's local rollout stream; events omitted by Codex cannot be displayed live.",
    ],
  });
});

test("an empty profile model lets the local Codex CLI choose the account default", async () => {
  const cli = new FakeCodexCli();
  const runtime = new CodexRuntime({ cli, cwd: "/workspace" });
  const session = await runtime.createSession({ agentId: "a", profile: { ...profile, model: "" } });
  const sending = runtime.send(session, "hello")[Symbol.asyncIterator]();
  const next = sending.next();
  assert.deepEqual(cli.calls[0], [
    "exec",
    "--json",
    "--sandbox",
    "workspace-write",
    "--cd",
    "/workspace",
    "Make scoped changes.\n\nhello",
  ]);
  cli.processes[0].finish();
  await next;
});
