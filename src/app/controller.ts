import type { AgentProfile } from "../domain/index.js";
import type { AgentEvent, AgentRuntime, RuntimeSession } from "../runtimes/types.js";

export class MainAgentController {
  private session?: RuntimeSession;
  constructor(private readonly runtime: AgentRuntime, private readonly profile: AgentProfile, private readonly onEvent: (event: AgentEvent) => void) {}
  async send(message: string): Promise<void> {
    this.session ??= await this.runtime.createSession({ agentId: "main", profile: this.profile, allowedTools: this.profile.allowedTools });
    for await (const event of this.runtime.send(this.session, message)) this.onEvent(event);
  }
}
