import type { AgentInstance } from "../domain/index.js";
import type { AgentEvent } from "../runtimes/types.js";

export interface ViewSnapshot {
  agents: readonly AgentInstance[];
  selectedId: string;
  lines: readonly string[];
  awaitingResponse: boolean;
}
export class SupervisorViewModel {
  private selected: string;
  private awaitingResponse = false;
  private readonly agents: AgentInstance[];
  constructor(
    agents: readonly AgentInstance[],
    private readonly transcripts: Map<string, string[]>,
  ) {
    this.agents = [...agents];
    this.selected = agents.find((agent) => agent.role === "main")?.id ?? agents[0]?.id ?? "";
  }
  select(id: string): void {
    if (this.agents.some((agent) => agent.id === id)) this.selected = id;
  }
  selectedId(): string {
    return this.selected;
  }
  setAwaitingResponse(awaiting: boolean): void {
    this.awaitingResponse = awaiting;
  }
  handleRuntimeEvent(event: AgentEvent): void {
    if (event.type === "worker-event") {
      const worker = this.agents.find((agent) => agent.id === event.workerId);
      if (!worker) return;
      const transcript = this.transcripts.get(event.workerId) ?? [];
      transcript.push(workerEventLine(event.event));
      this.transcripts.set(event.workerId, transcript);
      if (event.event.type === "completed") {
        worker.status = "completed";
        worker.finishedAt = Date.now();
      }
      if (event.event.type === "failed") {
        worker.status = "failed";
        worker.finishedAt = Date.now();
      }
      return;
    }
    if (event.type !== "worker-started" || this.agents.some((agent) => agent.id === event.workerId))
      return;
    const ordinal =
      this.agents.filter((agent) => agent.role === "worker" && agent.profileId === event.name)
        .length + 1;
    this.agents.push({
      id: event.workerId,
      sessionId: "main",
      profileId: event.name,
      role: "worker",
      ordinal,
      status: "running",
      task: event.name,
      createdAt: event.startedAt,
      startedAt: event.startedAt,
    });
    this.transcripts.set(event.workerId, [`Native Codex worker: ${event.name}`, "Status: running"]);
  }
  snapshot(): ViewSnapshot {
    return {
      agents: this.agents,
      selectedId: this.selected,
      lines: this.transcripts.get(this.selected) ?? [],
      awaitingResponse: this.awaitingResponse,
    };
  }
  submit(message: string, sendToMain: (message: string) => void): void {
    if (message.trim()) {
      this.awaitingResponse = true;
      sendToMain(message);
    }
  }
}

function workerEventLine(event: Extract<AgentEvent, { type: "worker-event" }>["event"]): string {
  switch (event.type) {
    case "text":
      return `Worker: ${event.text}`;
    case "activity":
      return `Activity: ${event.message}`;
    case "tool-requested":
      return `Tool requested: ${event.tool} — ${event.reason}`;
    case "tool-started":
      return `Tool started: ${event.tool}`;
    case "tool-finished":
      return `Tool finished: ${event.tool} — ${event.result}`;
    case "warning":
      return `Warning: ${event.message}`;
    case "completed":
      return `Completed: ${event.summary}`;
    case "failed":
      return `Failed: ${event.message}`;
  }
}

/** Turns a runtime event into a user-facing main-chat message when appropriate. */
export function mainChatLine(event: AgentEvent): string | undefined {
  if (event.type === "text") return `Assistant: ${event.text}`;
  if (event.type === "failed") return `Assistant error: ${event.message}`;
  return undefined;
}

const icon: Record<AgentInstance["status"], string> = {
  queued: "○",
  running: "◐",
  "waiting-for-approval": "!",
  completed: "✓",
  failed: "×",
  cancelled: "–",
};
const clip = (text: string, width: number) =>
  text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`;
const dimensions = (width: number) => {
  const sidebar = Math.max(22, Math.min(32, Math.floor(width * 0.3)));
  return { sidebar, pane: Math.max(20, width - sidebar - 1) };
};
const wrap = (text: string, width: number): string[] => {
  if (!text) return [""];
  const rows: string[] = [];
  let remaining = text;
  while (remaining.length > width) {
    const candidate = remaining.slice(0, width + 1);
    const space = candidate.lastIndexOf(" ");
    const split = space > 0 ? space : width;
    rows.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  rows.push(remaining);
  return rows;
};

export function sidebarAgentAt(
  view: ViewSnapshot,
  x: number,
  y: number,
  width: number,
): AgentInstance | undefined {
  const { pane } = dimensions(width);
  if (x <= pane + 1) return undefined;
  return view.agents[y - 2];
}

export function renderScreen(
  view: ViewSnapshot,
  width: number,
  height: number,
  input = "",
  ansi = false,
  spinner = "◐",
): string {
  const { sidebar, pane } = dimensions(width);
  const contentRows = Math.max(1, height - 4);
  const selected = view.agents.find((agent) => agent.id === view.selectedId);
  const content = [
    `${selected?.role === "main" ? "Main agent" : `Worker: ${selected?.profileId} #${selected?.ordinal}`}`,
    ...view.lines,
  ].flatMap((line) => wrap(line, pane));
  const rows = Array.from({ length: contentRows }, (_, row) => {
    const left = clip(content[row] ?? "", pane).padEnd(pane);
    const agent = view.agents[row];
    const name = agent
      ? `${agent.id === view.selectedId ? ">" : " "}${icon[agent.status]} ${agent.role === "main" ? "Main agent" : `${agent.profileId} #${agent.ordinal}`}`
      : "";
    const right = clip(name, sidebar).padEnd(sidebar);
    return `${left}│${agent?.id === view.selectedId && ansi ? `\x1b[7m${right}\x1b[0m` : right}`;
  });
  const title = `${ansi ? "\x1b[1m" : ""}${clip(selected?.role === "main" ? "Main conversation" : `Worker inspection: ${selected?.profileId ?? ""}`, pane)}${ansi ? "\x1b[0m" : ""}`;
  const main = view.agents[0];
  const mainName = main
    ? clip(
        `${main.id === view.selectedId ? ">" : " "}${icon[main.status]} ${main.role === "main" ? "Main agent" : `${main.profileId} #${main.ordinal}`}`,
        sidebar,
      ).padEnd(sidebar)
    : "Agent sessions".padEnd(sidebar);
  rows[0] = `${title.padEnd(pane)}│${main?.id === view.selectedId && ansi ? `\x1b[7m${mainName}\x1b[0m` : mainName}`;
  const thinking = view.awaitingResponse ? `${spinner} Thinking…` : "";
  return [
    `${"─".repeat(pane)}┬${"─".repeat(sidebar)}`,
    ...rows,
    `${"─".repeat(width)}`,
    clip(thinking, width),
    `${ansi ? "\x1b[1m" : ""}${clip(input || "Message main agent…", width)}${ansi ? "\x1b[0m" : ""}`,
  ].join("\n");
}

/** Replaces a frame without exposing the erase/redraw cycle to supporting terminals. */
export function terminalFrame(screen: string): string {
  return `\x1b[?2026h\x1b[H${screen}\x1b[J\x1b[?2026l`;
}
