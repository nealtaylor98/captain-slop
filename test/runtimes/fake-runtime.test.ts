import assert from "node:assert/strict";
import test from "node:test";
import { FakeRuntime } from "../../src/runtimes/fake-runtime.js";

test("fake runtime deterministically streams configured events", async () => {
  const runtime = new FakeRuntime({
    hello: [
      { type: "text", text: "working" },
      { type: "completed", summary: "done" },
    ],
  });
  const session = await runtime.createSession({
    agentId: "a",
    profile: { id: "p", provider: "fake", model: "demo", instructions: "", allowedTools: [] },
  });
  const events = [];
  for await (const event of runtime.send(session, "hello")) events.push(event);
  assert.deepEqual(
    events.map((event) => event.type),
    ["text", "completed"],
  );
});
