import type { AgentProfile } from "../domain/index.js";
import type { AgentEvent, AgentRuntime, RuntimeSession } from "../runtimes/types.js";

export class MainAgentController {
  private session?: RuntimeSession;
  private active = false;
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly profile: AgentProfile,
    private readonly onEvent: (event: AgentEvent) => unknown | Promise<unknown>,
    private readonly resumedSessionId?: string,
    private readonly onRuntimeSession?: (id: string) => unknown | Promise<unknown>,
  ) {}
  runtimeSessionId(): string | undefined {
    return this.session?.id ?? this.resumedSessionId;
  }
  async send(message: string): Promise<void> {
    if (this.active) throw new Error("The main agent already has an active turn.");
    this.active = true;
    try {
      this.session ??= this.resumedSessionId
        ? await this.runtime.resumeSession(this.resumedSessionId)
        : await this.runtime.createSession({
            agentId: "main",
            profile: this.profile,
            allowedTools: this.profile.allowedTools,
          });
      let knownId = this.resumedSessionId;
      if (this.session.id !== knownId) {
        knownId = this.session.id;
        await this.onRuntimeSession?.(knownId);
      }
      for await (const event of this.runtime.send(this.session, message)) {
        if (this.session.id !== knownId) {
          knownId = this.session.id;
          await this.onRuntimeSession?.(knownId);
        }
        await this.onEvent(event);
      }
    } finally {
      this.active = false;
    }
  }
}
