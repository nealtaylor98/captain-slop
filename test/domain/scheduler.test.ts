import assert from "node:assert/strict";
import test from "node:test";
import { WorkerScheduler } from "../../src/domain/scheduler.js";
import { FakeRuntime } from "../../src/runtimes/fake-runtime.js";
import type { AgentRuntime, RuntimeSession, SessionOptions } from "../../src/runtimes/types.js";

const profile = {
  id: "researcher",
  provider: "fake",
  model: "demo",
  instructions: "report",
  allowedTools: ["read_file"],
};

test("scheduler runs multiple instances of one profile and routes reports", async () => {
  const runtime = new FakeRuntime({
    first: [{ type: "completed", summary: "first report" }],
    second: [{ type: "completed", summary: "second report" }],
  });
  const scheduler = new WorkerScheduler({
    runtimes: new Map([["fake", runtime]]),
    profiles: [profile],
    globalTools: [],
    concurrency: 2,
  });
  const first = scheduler.spawn("session", "researcher", "first");
  const second = scheduler.spawn("session", "researcher", "second");
  await scheduler.idle();
  assert.equal(first.ordinal, 1);
  assert.equal(second.ordinal, 2);
  assert.deepEqual(
    scheduler
      .reports()
      .map((report) => report.summary)
      .sort(),
    ["first report", "second report"],
  );
  assert.ok(scheduler.workers().every((worker) => worker.status === "completed"));
});

test("scheduler delivers a completed worker report to the main-agent route", async () => {
  const routed: string[] = [];
  const runtime = new FakeRuntime({ task: [{ type: "completed", summary: "result" }] });
  const scheduler = new WorkerScheduler({
    runtimes: new Map([["fake", runtime]]),
    profiles: [profile],
    globalTools: [],
    concurrency: 1,
    onReport: (report) => routed.push(report.summary),
  });
  scheduler.spawn("session", "researcher", "task");
  await scheduler.idle();
  assert.deepEqual(routed, ["result"]);
});

test("scheduler retains queued work at its concurrency limit and can cancel it", async () => {
  const runtime = new FakeRuntime({ slow: [{ type: "text", text: "still working" }] });
  const scheduler = new WorkerScheduler({
    runtimes: new Map([["fake", runtime]]),
    profiles: [profile],
    globalTools: [],
    concurrency: 1,
  });
  scheduler.spawn("session", "researcher", "slow");
  const queued = scheduler.spawn("session", "researcher", "slow");
  assert.equal(queued.status, "queued");
  scheduler.cancel(queued.id);
  assert.equal(queued.status, "cancelled");
});

test("scheduler retains a runtime session id discovered during the first streamed turn", async () => {
  class NativeIdRuntime implements AgentRuntime {
    capabilities() {
      return { enforcedTools: false, limitations: [] };
    }
    async createSession(_options: SessionOptions): Promise<RuntimeSession> {
      return { id: "pending", agentId: "worker" };
    }
    async resumeSession(id: string): Promise<RuntimeSession> {
      return { id, agentId: "worker" };
    }
    async *send(session: RuntimeSession) {
      session.id = "native-session";
      yield { type: "completed" as const, summary: "done" };
    }
    async cancel(_session: RuntimeSession): Promise<void> {}
  }
  const scheduler = new WorkerScheduler({
    runtimes: new Map([["fake", new NativeIdRuntime()]]),
    profiles: [profile],
    globalTools: [],
    concurrency: 1,
  });
  const worker = scheduler.spawn("session", "researcher", "task");
  await scheduler.idle();
  assert.equal(worker.runtimeSessionId, "native-session");
});

test("scheduler routes and buffers fake worker progress in order through completion", async () => {
  const routed: string[] = [];
  const runtime = new FakeRuntime({
    timer: [
      { type: "text", text: "5 seconds" },
      { type: "text", text: "10 seconds" },
      { type: "text", text: "15 seconds" },
      { type: "text", text: "20 seconds" },
      { type: "completed", summary: "done" },
    ],
  });
  const scheduler = new WorkerScheduler({
    runtimes: new Map([["fake", runtime]]),
    profiles: [profile],
    globalTools: [],
    concurrency: 1,
    onEvent: (_worker, event) => {
      if (event.type === "text") routed.push(event.text);
    },
  });
  const worker = scheduler.spawn("session", "researcher", "timer");
  await scheduler.idle();
  assert.deepEqual(routed, ["5 seconds", "10 seconds", "15 seconds", "20 seconds"]);
  assert.deepEqual(
    scheduler.events(worker.id).map((event) => event.type),
    ["text", "text", "text", "text", "completed"],
  );
  assert.equal(worker.status, "completed");
});

test("scheduler routes and buffers fake worker failures", async () => {
  const runtime = new FakeRuntime({ timer: [{ type: "failed", message: "boom" }] });
  const scheduler = new WorkerScheduler({
    runtimes: new Map([["fake", runtime]]),
    profiles: [profile],
    globalTools: [],
    concurrency: 1,
  });
  const worker = scheduler.spawn("session", "researcher", "timer");
  await scheduler.idle();
  assert.deepEqual(scheduler.events(worker.id), [{ type: "failed", message: "boom" }]);
  assert.equal(worker.status, "failed");
});
