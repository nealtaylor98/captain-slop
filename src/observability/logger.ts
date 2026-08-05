import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface LogContext {
  appSessionId?: string;
  agentId?: string;
  runtimeSessionId?: string;
  turnId?: string;
  workerId?: string;
  correlationId?: string;
}

export interface LoggerOptions {
  directory: string;
  level?: LogLevel;
  maxBytes?: number;
  maxFiles?: number;
  retentionDays?: number;
  clock?: () => number;
  onFailure?: (error: unknown) => void;
}

const levels: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const sensitiveKey =
  /(?:authorization|cookie|credential|secret|token|password|api.?key|environment|prompt|message|body|command.?output|stdout|stderr)/i;
const sensitiveValue = /^(?:bearer|basic)\s+\S+|^(?:sk|gh[oprsu])_[A-Za-z0-9_-]{8,}$/i;

export const correlationId = (): string => randomUUID();

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string" && sensitiveValue.test(value)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[REDACTED]";
    seen.add(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redact(item, seen),
      ]),
    );
  }
  return value;
}

export class JsonLinesLogger {
  private readonly path: string;
  private readonly threshold: number;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly retentionMs: number;
  private readonly clock: () => number;
  private chain = Promise.resolve();

  constructor(private readonly options: LoggerOptions) {
    this.path = join(options.directory, "captain-slop.jsonl");
    this.threshold = levels[options.level ?? "info"];
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
    this.maxFiles = Math.max(1, options.maxFiles ?? 5);
    this.retentionMs = (options.retentionDays ?? 7) * 24 * 60 * 60 * 1000;
    this.clock = options.clock ?? Date.now;
  }

  error(component: string, event: string, context: LogContext = {}, data?: unknown): Promise<void> {
    return this.write("error", component, event, context, data);
  }
  warn(component: string, event: string, context: LogContext = {}, data?: unknown): Promise<void> {
    return this.write("warn", component, event, context, data);
  }
  info(component: string, event: string, context: LogContext = {}, data?: unknown): Promise<void> {
    return this.write("info", component, event, context, data);
  }
  debug(component: string, event: string, context: LogContext = {}, data?: unknown): Promise<void> {
    return this.write("debug", component, event, context, data);
  }
  close(): Promise<void> {
    return this.chain;
  }

  private write(
    level: LogLevel,
    component: string,
    event: string,
    context: LogContext,
    data?: unknown,
  ): Promise<void> {
    if (levels[level] > this.threshold) return Promise.resolve();
    const record = {
      timestamp: new Date(this.clock()).toISOString(),
      level,
      component,
      event,
      ...context,
      ...(data === undefined ? {} : { data: redact(data) }),
    };
    const line = `${JSON.stringify(record)}\n`;
    this.chain = this.chain
      .catch(() => undefined)
      .then(async () => {
        try {
          await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
          await this.removeExpired();
          await this.rotateIfNeeded(Buffer.byteLength(line));
          await appendFile(this.path, line, { encoding: "utf8", mode: 0o600 });
        } catch (error) {
          try {
            this.options.onFailure?.(error);
          } catch {
            // Failure reporting is best effort and must not affect the application.
          }
        }
      });
    return this.chain;
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let size = 0;
    try {
      size = (await stat(this.path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (size === 0 || size + incomingBytes <= this.maxBytes) return;
    const oldest = join(this.options.directory, `captain-slop.${this.maxFiles - 1}.jsonl`);
    if (this.maxFiles > 1) await unlink(oldest).catch(ignoreMissing);
    for (let index = this.maxFiles - 2; index >= 1; index -= 1) {
      await rename(
        join(this.options.directory, `captain-slop.${index}.jsonl`),
        join(this.options.directory, `captain-slop.${index + 1}.jsonl`),
      ).catch(ignoreMissing);
    }
    if (this.maxFiles > 1)
      await rename(this.path, join(this.options.directory, "captain-slop.1.jsonl"));
    else await unlink(this.path);
  }

  private async removeExpired(): Promise<void> {
    const cutoff = this.clock() - this.retentionMs;
    for (const name of await readdir(this.options.directory)) {
      if (!/^captain-slop(?:\.\d+)?\.jsonl$/.test(name)) continue;
      const path = join(this.options.directory, name);
      if ((await stat(path)).mtimeMs < cutoff) await unlink(path);
    }
  }
}

function ignoreMissing(error: unknown): void {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
