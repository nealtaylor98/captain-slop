import assert from "node:assert/strict";
import test from "node:test";
import { logLevel } from "../../src/observability/config.js";

test("debug logging is explicitly enabled by flag or environment", () => {
  assert.equal(logLevel([], {}), "info");
  assert.equal(logLevel(["--debug-logging"], {}), "debug");
  assert.equal(logLevel([], { CAPTAIN_SLOP_LOG_LEVEL: "debug" }), "debug");
  assert.equal(logLevel([], { CAPTAIN_SLOP_LOG_LEVEL: "unexpected" }), "info");
});
