import type { AgentProfile } from "../domain/index.js";
import { CodexRuntime } from "../runtimes/codex-runtime.js";
import { FakeRuntime } from "../runtimes/fake-runtime.js";
import type { AgentRuntime } from "../runtimes/types.js";

/** Builds only the configured provider adapters; fake remains available for demo/tests. */
export function createRuntimes(profiles: readonly AgentProfile[]): Map<string, AgentRuntime> {
  const runtimes = new Map<string, AgentRuntime>([["fake", new FakeRuntime()]]);
  if (profiles.some((profile) => profile.provider === "codex"))
    runtimes.set("codex", new CodexRuntime());
  for (const profile of profiles) {
    if (!runtimes.has(profile.provider))
      throw new Error(`No runtime adapter is available for provider: ${profile.provider}`);
  }
  return runtimes;
}
