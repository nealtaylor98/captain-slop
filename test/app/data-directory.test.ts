import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureDataDirectory } from "../../src/app/data-directory.js";

test("data directory adopts existing data from the legacy product name", async () => {
  const base = await mkdtemp(join(tmpdir(), "captain-slop-"));
  try {
    const legacy = join(base, ["t", "code"].join(""));
    await mkdir(legacy);
    await writeFile(join(legacy, "state.json"), "saved conversation", "utf8");

    const current = await ensureDataDirectory(base);

    assert.equal(current, join(base, "captain-slop"));
    assert.equal(await readFile(join(current, "state.json"), "utf8"), "saved conversation");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
