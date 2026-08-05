import assert from "node:assert/strict";
import test from "node:test";
import { effectiveTools, requestPolicyChange, transitionStatus, PolicyManager } from "../../src/domain/index.js";

test("effective permissions combine baseline, profile and explicitly approved task grants", () => {
  const tools = effectiveTools(["read_file"], ["search_files"], ["shell"]);
  assert.deepEqual([...tools].sort(), ["read_file", "search_files", "shell"]);
});

test("privileges outside policy require a pending user approval", () => {
  const request = requestPolicyChange("worker-1", "workspace_write", "needed for scoped edit");
  assert.equal(request.status, "pending");
  assert.equal(request.requestedBy, "worker-1");
});

test("agent statuses only make valid lifecycle transitions", () => {
  assert.equal(transitionStatus("queued", "running"), "running");
  assert.throws(() => transitionStatus("completed", "running"));
});

test("policy changes cannot persist until explicitly confirmed", () => {
  const policy = new PolicyManager(["read_file"]);
  const proposal = policy.propose("main", "global", "shell", "user requested shell access");
  assert.deepEqual([...policy.globalTools()], ["read_file"]);
  policy.confirm(proposal.id);
  assert.deepEqual([...policy.globalTools()].sort(), ["read_file", "shell"]);
});
