import type { AgentInstance } from "../domain/index.js";
import type { TranscriptEntry } from "../domain/transcript.js";

export function initialAgents(demo: boolean, now = Date.now()): AgentInstance[] {
  const main: AgentInstance = {
    id: "main",
    sessionId: "demo",
    profileId: "main",
    role: "main",
    ordinal: 1,
    status: "running",
    task: "",
    createdAt: now,
  };
  if (!demo) return [main];
  return [
    main,
    {
      id: "worker-1",
      sessionId: "demo",
      profileId: "researcher",
      role: "worker",
      ordinal: 1,
      status: "completed",
      task: "Inspect the test suite",
      createdAt: now,
      finishedAt: now,
    },
  ];
}

export function initialTranscripts(demo: boolean): Map<string, (TranscriptEntry | string)[]> {
  const transcripts = new Map<string, (TranscriptEntry | string)[]>([
    ["main", [{ kind: "agent", text: "Ready to supervise coding agents." }]],
  ]);
  if (demo)
    transcripts.set("worker-1", [
      "Task: Inspect the test suite",
      "Report: Fake worker completed its inspection.",
    ]);
  return transcripts;
}
