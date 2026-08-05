import assert from "node:assert/strict";
import test from "node:test";
import { initialAgents, initialTranscripts } from "../../src/app/initial-view.js";

test("regular startup contains only the main agent, while demo startup includes its sample worker", () => {
  assert.deepEqual(
    initialAgents(false, 0).map((agent) => agent.id),
    ["main"],
  );
  assert.deepEqual(
    initialAgents(true, 0).map((agent) => agent.id),
    ["main", "worker-1"],
  );
  assert.equal(initialTranscripts(false).has("worker-1"), false);
  assert.equal(initialTranscripts(true).has("worker-1"), true);
});
