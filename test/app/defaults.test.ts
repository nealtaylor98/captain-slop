import assert from "node:assert/strict";
import test from "node:test";
import { defaultMainProfile } from "../../src/app/defaults.js";

test("the normal interactive default is a Codex main agent", () => {
  const profile = defaultMainProfile();
  assert.equal(profile.provider, "codex");
  assert.equal(profile.id, "main");
});
