import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WorkerReport } from "../domain/index.js";
import type { Persistence, StoredEvent, StoredSession } from "./types.js";

interface State { sessions: StoredSession[]; events: Record<string, StoredEvent[]>; reports: WorkerReport[]; }
const empty = (): State => ({ sessions: [], events: {}, reports: [] });

export class LocalStore implements Persistence {
  private state: State = empty();
  private writeChain: Promise<void> = Promise.resolve();
  constructor(private readonly path: string) {}
  async open(): Promise<void> {
    try { this.state = JSON.parse(await readFile(this.path, "utf8")) as State; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await this.flush(); }
  }
  sessions(): readonly StoredSession[] { return this.state.sessions; }
  events(sessionId: string): readonly StoredEvent[] { return this.state.events[sessionId] ?? []; }
  reports(): readonly WorkerReport[] { return this.state.reports; }
  async saveSession(session: StoredSession): Promise<void> {
    const index = this.state.sessions.findIndex((stored) => stored.id === session.id);
    if (index >= 0) this.state.sessions[index] = session; else this.state.sessions.push(session);
    await this.persist();
  }
  async appendEvent(sessionId: string, event: StoredEvent): Promise<void> { (this.state.events[sessionId] ??= []).push(event); await this.persist(); }
  async saveReport(report: WorkerReport): Promise<void> { this.state.reports.push(report); await this.persist(); }
  async cleanup(now: number): Promise<number> {
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const expired = this.state.sessions.filter((session) => session.updatedAt < cutoff).map((session) => session.id);
    this.state.sessions = this.state.sessions.filter((session) => !expired.includes(session.id));
    for (const id of expired) delete this.state.events[id];
    if (expired.length) await this.persist();
    return expired.length;
  }
  private async flush(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state, null, 2), "utf8");
    await rename(temporary, this.path);
  }
  private persist(): Promise<void> {
    this.writeChain = this.writeChain.catch(() => undefined).then(() => this.flush());
    return this.writeChain;
  }
}
