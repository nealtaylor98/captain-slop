import type {
  AgentRuntime,
  AgentEvent,
  RuntimeCapabilities,
  RuntimeSession,
  SessionOptions,
} from "./types.js";

export class FakeRuntime implements AgentRuntime {
  private nextId = 1;
  private readonly sessions = new Map<string, RuntimeSession>();
  constructor(private readonly scripts: Record<string, AgentEvent[]> = {}) {}
  async createSession(options: SessionOptions): Promise<RuntimeSession> {
    const session = { id: `fake-${this.nextId++}`, agentId: options.agentId };
    this.sessions.set(session.id, session);
    return session;
  }
  async resumeSession(id: string): Promise<RuntimeSession> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown fake session: ${id}`);
    return session;
  }
  async *send(_session: RuntimeSession, message: string): AsyncIterable<AgentEvent> {
    for (const event of this.scripts[message] ?? [
      { type: "completed", summary: `Fake completed: ${message}` },
    ])
      yield event;
  }
  async cancel(_session: RuntimeSession): Promise<void> {}
  capabilities(): RuntimeCapabilities {
    return { enforcedTools: true, limitations: [] };
  }
}
