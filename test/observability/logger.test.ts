import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonLinesLogger, correlationId, redact } from "../../src/observability/logger.js";

test("formats JSON Lines with correlation metadata and filters below the configured level", async () => {
  const directory = await mkdtemp(join(tmpdir(), "captain-slop-logs-"));
  const logger = new JsonLinesLogger({ directory, level: "info", clock: () => 123 });
  await logger.debug("runtime", "ignored");
  await logger.info("runtime", "turn.started", {
    appSessionId: "app-1",
    agentId: "main",
    runtimeSessionId: "runtime-1",
    turnId: "turn-1",
    workerId: "worker-1",
    correlationId: "corr-1",
  });
  await logger.close();

  const record = JSON.parse(await readFile(join(directory, "captain-slop.jsonl"), "utf8"));
  assert.deepEqual(record, {
    timestamp: "1970-01-01T00:00:00.123Z",
    level: "info",
    component: "runtime",
    event: "turn.started",
    appSessionId: "app-1",
    agentId: "main",
    runtimeSessionId: "runtime-1",
    turnId: "turn-1",
    workerId: "worker-1",
    correlationId: "corr-1",
  });
  assert.match(correlationId(), /^[0-9a-f-]{36}$/);
});

test("redacts sensitive keys and values recursively without mutating input", () => {
  const input = {
    token: "secret-token",
    nested: {
      Authorization: "Bearer abc",
      safe: "ok",
      note: "Bearer leaked-value",
      commandOutput: "private output",
    },
    prompt: "private prompt",
    environment: { HOME: "/private", API_KEY: "secret" },
  };
  assert.deepEqual(redact(input), {
    token: "[REDACTED]",
    nested: {
      Authorization: "[REDACTED]",
      safe: "ok",
      note: "[REDACTED]",
      commandOutput: "[REDACTED]",
    },
    prompt: "[REDACTED]",
    environment: "[REDACTED]",
  });
  assert.equal(input.token, "secret-token");
});

test("rotates bounded files and removes files older than retention", async () => {
  const directory = await mkdtemp(join(tmpdir(), "captain-slop-logs-"));
  const old = join(directory, "captain-slop.1.jsonl");
  await writeFile(old, "old\n");
  await utimes(old, new Date(0), new Date(0));
  const logger = new JsonLinesLogger({
    directory,
    maxBytes: 120,
    maxFiles: 2,
    retentionDays: 1,
    clock: () => 3 * 24 * 60 * 60 * 1000,
  });
  await logger.info("test", "large", {}, { safe: "x".repeat(100) });
  await logger.info("test", "large", {}, { safe: "x".repeat(100) });
  await logger.close();
  const files = await readdir(directory);
  assert.ok(files.includes("captain-slop.jsonl"));
  assert.ok(files.length <= 2);
  for (const file of files) assert.ok((await stat(join(directory, file))).size > 0);
});

test("logging failures are reported but never reject, including failure records", async () => {
  const failures: unknown[] = [];
  const logger = new JsonLinesLogger({
    directory: "/dev/null/impossible",
    onFailure: (error) => failures.push(error),
  });
  await assert.doesNotReject(logger.error("store", "store.failed", {}, { error: "boom" }));
  await assert.doesNotReject(logger.close());
  assert.ok(failures.length >= 1);
});

test("a failing failure callback cannot crash the application", async () => {
  const logger = new JsonLinesLogger({
    directory: "/dev/null/impossible",
    onFailure: () => {
      throw new Error("callback failure");
    },
  });
  await assert.doesNotReject(logger.error("application", "application.failed"));
});
