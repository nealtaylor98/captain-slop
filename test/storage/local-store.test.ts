import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStore } from "../../src/storage/local-store.js";

test("local store persists sessions, events and reports", async () => {
  const dir = await mkdtemp(join(tmpdir(), "captain-slop-"));
  try {
    const store = new LocalStore(join(dir, "state.json"));
    await store.open();
    await store.saveSession({ id: "s1", createdAt: 1, updatedAt: 1, mainAgentId: "main" });
    await store.appendEvent("s1", {
      at: 2,
      agentId: "main",
      event: { type: "text", text: "hello" },
    });
    await store.saveReport({
      workerId: "w1",
      status: "completed",
      summary: "done",
      artifacts: [],
      changes: [],
    });
    const restored = new LocalStore(join(dir, "state.json"));
    await restored.open();
    assert.equal(restored.sessions()[0].id, "s1");
    assert.equal(restored.events("s1")[0].event.type, "text");
    assert.equal(restored.reports()[0].summary, "done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retention removes sessions and their event streams older than thirty days", async () => {
  const dir = await mkdtemp(join(tmpdir(), "captain-slop-"));
  try {
    const store = new LocalStore(join(dir, "state.json"));
    await store.open();
    const old = 0;
    const recent = 31 * 24 * 60 * 60 * 1000;
    await store.saveSession({ id: "old", createdAt: old, updatedAt: old, mainAgentId: "m" });
    await store.saveSession({
      id: "recent",
      createdAt: recent,
      updatedAt: recent,
      mainAgentId: "m",
    });
    await store.cleanup(31 * 24 * 60 * 60 * 1000);
    assert.deepEqual(
      store.sessions().map((session) => session.id),
      ["recent"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent event appends are serialized without competing temporary-file renames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "captain-slop-"));
  try {
    const store = new LocalStore(join(dir, "state.json"));
    await store.open();
    await store.saveSession({ id: "s", createdAt: 1, updatedAt: 1, mainAgentId: "m" });
    await Promise.all(
      Array.from({ length: 8 }, (_, at) =>
        store.appendEvent("s", { at, agentId: "m", event: { type: "text", text: String(at) } }),
      ),
    );
    assert.equal(store.events("s").length, 8);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("latest session can be reopened with its runtime thread and transcript", async () => {
  const dir = await mkdtemp(join(tmpdir(), "captain-slop-"));
  try {
    const path = join(dir, "state.json");
    const store = new LocalStore(path);
    await store.open();
    await store.saveSession({ id: "older", createdAt: 1, updatedAt: 2, mainAgentId: "main" });
    await store.saveSession({
      id: "current",
      createdAt: 3,
      updatedAt: 4,
      mainAgentId: "main",
      runtimeSessionId: "native-thread",
    });
    await store.appendEvent("current", {
      at: 5,
      agentId: "main",
      event: { type: "user-message", text: "hello" },
    });

    const restored = new LocalStore(path);
    await restored.open();
    assert.equal(restored.latestSession()?.id, "current");
    assert.equal(restored.latestSession()?.runtimeSessionId, "native-thread");
    assert.equal(restored.events("current")[0].event.type, "user-message");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("compaction replaces older events with a durable summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "captain-slop-"));
  try {
    const path = join(dir, "state.json");
    const store = new LocalStore(path);
    await store.open();
    await store.saveSession({ id: "s", createdAt: 1, updatedAt: 1, mainAgentId: "main" });
    await store.appendEvent("s", {
      at: 2,
      agentId: "main",
      event: { type: "text", text: "old reply" },
    });
    await store.compactSession("s", "Earlier conversation summary", 3);

    const restored = new LocalStore(path);
    await restored.open();
    assert.deepEqual(restored.events("s"), []);
    assert.deepEqual(restored.latestSession()?.compaction, {
      compactedAt: 3,
      summary: "Earlier conversation summary",
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
