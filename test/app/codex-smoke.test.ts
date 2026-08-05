import assert from "node:assert/strict";
import test from "node:test";
import { codexSmoke } from "../../src/app/codex-smoke.js";

test("Codex smoke check only asks for version and local login status", async () => {
  const calls: string[][] = [];
  const output = await codexSmoke(async (args) => { calls.push(args); return args[0] === "--version" ? "codex-cli 0.146.0" : "Logged in"; });
  assert.deepEqual(calls, [["--version"], ["login", "status"]]);
  assert.equal(output, "codex-cli 0.146.0\nLogged in");
});
