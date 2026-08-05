import assert from "node:assert/strict";
import test from "node:test";
import { SupervisorViewModel, mainChatLine, renderScreen, sidebarAgentAt, terminalFrame } from "../../src/tui/index.js";

const agents = [
  { id: "main", sessionId: "s", profileId: "main", role: "main" as const, ordinal: 1, status: "running" as const, task: "", createdAt: 0 },
  { id: "worker-1", sessionId: "s", profileId: "research", role: "worker" as const, ordinal: 1, status: "completed" as const, task: "inspect tests", createdAt: 0 }
];

test("selecting a worker changes only the inspection pane", () => {
  const view = new SupervisorViewModel(agents, new Map([["main", ["Main: hello"]], ["worker-1", ["Worker: found issue"]]]));
  view.select("worker-1");
  assert.equal(view.selectedId(), "worker-1");
  assert.match(renderScreen(view.snapshot(), 80, 12), /Worker: found issue/);
  assert.match(renderScreen(view.snapshot(), 80, 12), /Message main agent/);
});

test("bottom input is always sent to the main agent", () => {
  const sent: string[] = [];
  const view = new SupervisorViewModel(agents, new Map()); view.select("worker-1");
  view.submit("please relay this", (message) => sent.push(message));
  assert.deepEqual(sent, ["please relay this"]);
});

test("rendered input replaces the placeholder when the user has started typing", () => {
  const view = new SupervisorViewModel(agents, new Map());
  const screen = renderScreen(view.snapshot(), 80, 12, "Hello");
  assert.match(screen, /Hello/);
  assert.doesNotMatch(screen, /Message main agent…/);
});

test("main chat renders assistant replies without runtime activity or completion noise", () => {
  assert.equal(mainChatLine({ type: "text", text: "I fixed it." }), "Assistant: I fixed it.");
  assert.equal(mainChatLine({ type: "failed", message: "The turn failed." }), "Assistant error: The turn failed.");
  assert.equal(mainChatLine({ type: "activity", message: "Codex is reasoning." }), undefined);
  assert.equal(mainChatLine({ type: "tool-started", tool: "shell" }), undefined);
  assert.equal(mainChatLine({ type: "completed", summary: "Codex completed the turn." }), undefined);
});

test("thinking indicator appears above the composer only while awaiting a main-agent response", () => {
  const view = new SupervisorViewModel(agents, new Map());
  assert.doesNotMatch(renderScreen(view.snapshot(), 80, 12), /Thinking/);
  view.setAwaitingResponse(true);
  const waiting = renderScreen(view.snapshot(), 80, 12);
  assert.match(waiting, /◐ Thinking…\nMessage main agent…/);
  view.setAwaitingResponse(false);
  assert.doesNotMatch(renderScreen(view.snapshot(), 80, 12), /Thinking/);
});

test("only clicks in the sidebar select an agent and the selected row is visibly highlighted", () => {
  const view = new SupervisorViewModel(agents, new Map());
  assert.equal(sidebarAgentAt(view.snapshot(), 10, 2, 80), undefined);
  assert.equal(sidebarAgentAt(view.snapshot(), 70, 3, 80)?.id, "worker-1");
  const screen = renderScreen(view.snapshot(), 80, 12, "", true);
  assert.match(screen, /\x1b\[7m.*Main agent/);
});

test("terminal frames use synchronized output and do not clear the screen between spinner ticks", () => {
  const frame = terminalFrame("screen contents");
  assert.equal(frame, "\x1b[?2026h\x1b[Hscreen contents\x1b[J\x1b[?2026l");
  assert.doesNotMatch(frame, /\x1b\[2J/);
});

test("native worker starts appear immediately in the agent sidebar", () => {
  const view = new SupervisorViewModel([agents[0]], new Map([["main", []]]));
  view.handleRuntimeEvent({ type: "worker-started", workerId: "native-worker", name: "timer_one", startedAt: 123 });
  assert.equal(view.snapshot().agents[1]?.id, "native-worker");
  assert.equal(view.snapshot().agents[1]?.status, "running");
  assert.match(renderScreen(view.snapshot(), 80, 12), /timer_one #1/);
});

test("long transcript messages wrap within the conversation pane", () => {
  const message = "This assistant response is deliberately long enough to continue onto another visible terminal row.";
  const view = new SupervisorViewModel([agents[0]], new Map([["main", [message]]]));
  const screen = renderScreen(view.snapshot(), 50, 12);
  assert.match(screen, /This assistant response is/);
  assert.match(screen, /deliberately long enough/);
  assert.match(screen, /continue onto another/);
  assert.match(screen, /visible terminal row/);
});
