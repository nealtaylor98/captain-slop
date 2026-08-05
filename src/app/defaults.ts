import type { AgentProfile } from "../domain/index.js";

/** The no-configuration interactive experience uses the local Codex CLI. */
export function defaultMainProfile(): AgentProfile {
  return {
    id: "main",
    provider: "codex",
    model: "",
    instructions: "You are the main coding supervisor. Respond directly to the user and clearly report progress and results.",
    allowedTools: ["read_file", "search_files", "workspace_write", "shell", "git"]
  };
}
