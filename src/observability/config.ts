import type { LogLevel } from "./logger.js";

export function logLevel(
  args: readonly string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): LogLevel {
  return args.includes("--debug-logging") || environment.CAPTAIN_SLOP_LOG_LEVEL === "debug"
    ? "debug"
    : "info";
}
