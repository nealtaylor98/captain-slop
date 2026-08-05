import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/app/config.js";
import { MainAgentController } from "../../src/app/controller.js";
import { FakeRuntime } from "../../src/runtimes/fake-runtime.js";
import { CodexRuntime } from "../../src/runtimes/codex-runtime.js";
import { createRuntimes } from "../../src/app/runtime-factory.js";

test("configuration loads provider-neutral profiles and allowed tools", () => {
  const config = loadConfig(`globalTools = ["read_file"]
[profiles.builder]
provider = "fake"
model = "demo"
instructions = "build carefully"
allowedTools = ["workspace_write"]`);
  assert.equal(config.profiles[0].provider, "fake");
  assert.deepEqual(config.profiles[0].allowedTools, ["workspace_write"]);
});

test("main controller stores only main-agent exchanges", async () => {
  const events: string[] = [];
  const controller = new MainAgentController(
    new FakeRuntime({
      hi: [
        { type: "text", text: "hello" },
        { type: "completed", summary: "done" },
      ],
    }),
    { id: "main", provider: "fake", model: "demo", instructions: "", allowedTools: [] },
    (event) => events.push(event.type),
  );
  await controller.send("hi");
  assert.deepEqual(events, ["text", "completed"]);
});

test("main controller resumes a persisted runtime session", async () => {
  const runtime = new FakeRuntime();
  const created = await runtime.createSession({
    agentId: "main",
    profile: { id: "main", provider: "fake", model: "demo", instructions: "", allowedTools: [] },
  });
  const controller = new MainAgentController(
    runtime,
    { id: "main", provider: "fake", model: "demo", instructions: "", allowedTools: [] },
    () => undefined,
    created.id,
  );
  await controller.send("continue");
  assert.equal(controller.runtimeSessionId(), created.id);
});

test("runtime composition selects Codex only for a Codex profile while fake remains the default", () => {
  const runtimes = createRuntimes([
    { id: "main", provider: "fake", model: "demo", instructions: "", allowedTools: [] },
    { id: "builder", provider: "codex", model: "gpt-5.6", instructions: "", allowedTools: [] },
  ]);
  assert.ok(runtimes.get("fake") instanceof FakeRuntime);
  assert.ok(runtimes.get("codex") instanceof CodexRuntime);
});
