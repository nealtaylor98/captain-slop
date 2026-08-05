import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MainSession } from "../../src/app/main-session.js";
import { FakeRuntime } from "../../src/runtimes/fake-runtime.js";
import { LocalStore } from "../../src/storage/local-store.js";

const profile = { id: "main", provider: "fake", model: "demo", instructions: "", allowedTools: [] };

test("main session persists user and streamed assistant messages and resumes the runtime", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tcode-"));
  try {
    const path = join(dir, "state.json");
    const firstStore = new LocalStore(path);
    await firstStore.open();
    const runtime = new FakeRuntime({
      hello: [
        { type: "text", text: "hi back" },
        { type: "completed", summary: "done" },
      ],
    });
    const first = await MainSession.open(firstStore, runtime, profile, () => 100);
    await first.send("hello");

    const secondStore = new LocalStore(path);
    await secondStore.open();
    const reopened = await MainSession.open(secondStore, runtime, profile, () => 200);
    assert.deepEqual(reopened.transcript(), ["You: hello", "Assistant: hi back"]);
    await reopened.send("continue");
    assert.equal(secondStore.latestSession()?.runtimeSessionId, "fake-1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("restored transcript starts with its compaction summary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tcode-"));
  try {
    const store = new LocalStore(join(dir, "state.json"));
    await store.open();
    await store.saveSession({
      id: "s",
      createdAt: 1,
      updatedAt: 2,
      mainAgentId: "main",
      compaction: { compactedAt: 2, summary: "We previously fixed login." },
    });
    const session = await MainSession.open(store, new FakeRuntime(), profile);
    assert.deepEqual(session.transcript(), ["Conversation summary: We previously fixed login."]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("retention runs on startup and once per scheduled day", async () => {
  const calls: number[] = [];
  let daily: (() => void) | undefined;
  const persistence = {
    cleanup: async (now: number) => {
      calls.push(now);
      return 0;
    },
  };
  const timer = await MainSession.startRetention(
    persistence,
    () => 10,
    (callback: () => void, delay: number) => {
      assert.equal(delay, 86_400_000);
      daily = callback;
      return { unref() {} } as NodeJS.Timeout;
    },
  );
  daily?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [10, 10]);
  assert.ok(timer);
});
