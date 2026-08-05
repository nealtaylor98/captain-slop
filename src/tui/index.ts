import type { AgentInstance } from "../domain/index.js";
import type { TranscriptEntry } from "../domain/transcript.js";
import type { AgentEvent } from "../runtimes/types.js";

export interface ViewSnapshot {
  agents: readonly AgentInstance[];
  selectedId: string;
  lines: readonly (TranscriptEntry | string)[];
  awaitingResponse: boolean;
}
export class SupervisorViewModel {
  private selected: string;
  private awaitingResponse = false;
  private readonly agents: AgentInstance[];
  constructor(
    agents: readonly AgentInstance[],
    private readonly transcripts: Map<string, (TranscriptEntry | string)[]>,
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

/** Turns a runtime event into a user-facing main-chat message when appropriate. */
export function mainChatLine(event: AgentEvent): TranscriptEntry | undefined {
  if (event.type === "text") return { kind: "agent", text: event.text };
  if (event.type === "failed") return { kind: "status", text: `Error: ${event.message}` };
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
  const sidebar = Math.max(10, Math.min(32, Math.floor(width * 0.3)));
  return { sidebar, pane: Math.max(1, width - sidebar - 1) };
};
const wrap = (text: string, width: number): string[] => {
  if (text.includes("\n")) return text.split("\n").flatMap((line) => wrap(line, width));
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

interface RenderedTranscriptRow {
  text: string;
  align: "left" | "right";
}

const transcriptRows = (line: TranscriptEntry | string, width: number): RenderedTranscriptRow[] => {
  const entry: TranscriptEntry = typeof line === "string" ? { kind: "status", text: line } : line;
  return wrap(entry.text, width).map((text) => ({
    text,
    align: entry.kind === "user" ? "right" : "left",
  }));
};

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
  const heading =
    selected?.role === "main"
      ? "Main agent"
      : `Worker: ${selected?.profileId} #${selected?.ordinal}`;
  const content: RenderedTranscriptRow[] = [
    ...wrap(heading, pane).map((text) => ({ text, align: "left" as const })),
    ...view.lines.flatMap((line) => transcriptRows(line, pane)),
  ];
  const rows = Array.from({ length: contentRows }, (_, row) => {
    const transcriptRow = content[row];
    const clipped = clip(transcriptRow?.text ?? "", pane);
    const left = transcriptRow?.align === "right" ? clipped.padStart(pane) : clipped.padEnd(pane);
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
