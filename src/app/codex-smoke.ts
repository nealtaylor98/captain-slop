export type CodexCommand = (args: string[]) => Promise<string>;

/** Safe local readiness check: it never invokes `codex exec` or sends a prompt. */
export async function codexSmoke(run: CodexCommand): Promise<string> {
  const version = await run(["--version"]);
  const status = await run(["login", "status"]);
  return `${version.trim()}\n${status.trim()}`.trim();
}
