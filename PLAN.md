# tcode implementation plan

## Product outcome

Build a local Linux terminal application that presents a supervisor-style
interface over one or more agent runtimes. Codex and Claude are first-class
targets; the UI, policies, and stored sessions must not depend on either one.

- One persistent **main agent** is the only agent the user talks to.
- The main agent can launch multiple independent **worker agents** in the
  background, including several instances of the same profile.
- Clicking a worker in the sidebar shows its live transcript and tool activity
  in the central pane.
- The text input always sends a message to the main agent, including while a
  worker transcript is selected.
- Workers return structured reports to the main agent. The main agent
  summarizes their outcomes and asks the user only when an approval or decision
  is required.

Provider runtimes supply agent threads, model inference, and provider-native
capabilities. tcode owns orchestration, presentation, local persistence, and
the policy layer. Codex is a suitable first adapter because its SDK supports
local threads and event streaming; it must not become an architectural
dependency of the rest of the application. See the official [Codex SDK documentation](https://learn.chatgpt.com/docs/codex-sdk.md).

## User experience — the original supervisor layout

tcode owns the entire terminal screen. It is not a small extension beneath the
Codex composer and does not try to modify Codex's native toolbar. Its primary
layout is the original two-column workspace:

```text
┌──────────────────────────────────────────────────┬──────────────────────────┐
│ Main-agent transcript or selected worker activity │ Agent sessions           │
│                                                  │ ● Main agent              │
│ Main: I delegated test triage to two workers.    │ ◐ Test triage #1  01:12  │
│                                                  │ ◐ Test triage #2  01:12  │
│ [Selected worker: live tool/activity transcript] │ ✓ Explorer #1    done    │
│                                                  │                          │
├──────────────────────────────────────────────────┴──────────────────────────┤
│ Message the main agent…                                             [send] │
└─────────────────────────────────────────────────────────────────────────────┘
```

The sidebar is always visible. It lists the main session plus every queued,
running, waiting, completed, and failed worker instance. The user can run more
than one instance of any profile.

When the **main agent** is selected, the central pane shows the main
conversation. When a **worker** is selected, that same central pane switches to
the worker's complete live view: its task, messages, tool activity, elapsed
time, and final report. It is an inspection switcher, not a second user chat.

The input remains fixed along the bottom of the screen and always addresses the
main agent. For example, while inspecting `Test triage #1`, the user can type
“ask that worker to focus on the failing integration test”; the main agent
receives the request, decides whether to relay it, and retains sole authority
for user-facing replies and permission escalation.

The agent sidebar is mouse-clickable where the terminal supports mouse events.
Text messages to the main agent remain the functional fallback for terminal
environments where mouse support is unavailable.

## Architecture

```text
Terminal UI
  ├─ central transcript/activity pane
  ├─ clickable agent-session sidebar
  └─ main-agent input
       │
Supervisor service
  ├─ main-thread controller
  ├─ worker scheduler and lifecycle manager
  ├─ permission-policy gate
  ├─ event router
  └─ session/artifact retention service
       │
Runtime adapter layer
  ├─ provider-neutral session/event interface
  ├─ Codex adapter
  ├─ Claude adapter
  └─ future adapters (other APIs/local models)
       │
Local storage (SQLite)
  ├─ sessions and agent instances
  ├─ events/transcripts and reports
  ├─ profile and policy configuration
  └─ retention/compaction metadata
```

## Provider-agnostic runtime design

Every provider implements the same lifecycle contract:

```ts
interface AgentRuntime {
  createSession(options: SessionOptions): Promise<RuntimeSession>;
  resumeSession(id: string): Promise<RuntimeSession>;
  send(session: RuntimeSession, message: UserMessage): AsyncIterable<AgentEvent>;
  cancel(session: RuntimeSession): Promise<void>;
  capabilities(): RuntimeCapabilities;
}
```

`AgentEvent` is a tcode-owned normalized stream: text, reasoning status, tool
requested/started/finished, approval needed, usage, warning, completed, and
failed. The sidebar, transcript renderer, scheduler, database, and policy
engine consume these neutral events—not provider-specific formats.

Profiles select their runtime and model explicitly, so a session can mix
providers:

```toml
[profiles.architect]
provider = "claude"
model = "claude-sonnet"
allowed = ["read_file", "search_files"]

[profiles.implementer]
provider = "codex"
model = "gpt-5.6"
allowed = ["workspace_write", "shell", "git"]
```

Credentials remain local and out of tcode's session database. A named
connection uses the provider's supported local authentication method or a
user-configured secret reference. Work and personal credentials are separate
connections that profiles select by name.

## Policy model

Permissions are evaluated before a worker begins an action or is relaunched
with elevated access.

```text
effective tools = global tool baseline ∪ agent-profile grants ∪ approved task grants
```

- **Global tools** are available to every agent, including the main agent.
- **Profile grants** cover extra tools appropriate to an agent type.
- **Task grants** are one-time, explicit approvals for tools outside those two
  sets.
- Any new privilege request must be surfaced to the user; neither the main
  agent nor a worker can self-approve it.
- The user can ask the main agent to update the global policy or a profile's
  policy. tcode presents the proposed change and requires confirmation before
  saving it.

Example configuration:

```toml
[tools.global]
allowed = ["read_file", "search_files", "shell", "git"]

[profiles.explorer]
provider = "claude"
model = "claude-sonnet"
allowed = ["web"]
instructions = "Investigate and report evidence. Do not change files."

[profiles.implementer]
provider = "codex"
model = "gpt-5.6"
allowed = ["workspace_write"]
instructions = "Make a scoped change and validate it."
```

The policy engine is provider-neutral. For runtimes with native sandboxing,
tcode maps effective permissions to the least-privileged runtime configuration.
For runtimes that call local tools through tcode, its tool runner enforces the
policy directly. An adapter must declare any capability it cannot enforce, and
tcode must show that limitation before the user starts the agent.

## Data and retention

- Store all state locally in SQLite under the user data directory.
- Keep full recent transcripts and event streams.
- Compact older transcripts into a main-thread summary plus worker reports.
- Delete sessions, logs, and stored artifacts after 30 days using a startup
  check plus a daily cleanup timer.
- Do not send session data to a tcode-operated service. Each provider uses the
  authentication and data-handling path chosen for its named local connection.

## Delivery phases

### Phase 0 — foundation and runtime contract (3–5 days)

- Initialize TypeScript project, formatter, linter, test runner, and packaging.
- Define domain types: profile, agent instance, task, event, report, approval,
  and session.
- Create SQLite schema and migrations.
- Define provider-neutral runtime, event, capability, credential-reference, and
  tool-bridge contracts.
- Build a fake runtime for deterministic UI and scheduler tests.
- Implement the Codex adapter and verify a simple main-thread prompt.

**Exit condition:** A local command can create/resume a provider-neutral agent
session and store a completed exchange in SQLite.

### Phase 1 — main agent and persistence (3–5 days)

- Implement a persistent main-agent thread and streaming event handling.
- Add the always-main-agent text input.
- Save/reopen sessions and render message history.
- Add transcript compaction primitives and the 30-day deletion job.

**Exit condition:** A user can close and reopen tcode without losing an active
main-agent conversation.

### Phase 2 — background workers and second provider (7–10 days)

- Add reusable profiles and multiple worker instances per profile.
- Build queueing, concurrency limits, cancellation, and failure handling.
- Implement structured worker reports: status, summary, artifacts, changes,
  suggested next step, and escalation request.
- Route worker completion reports back to the main thread.
- Implement the Claude adapter against its supported local/API runtime and
  normalize its streaming, tool, and approval events.
- Verify mixed-provider worker sessions (for example Claude researcher and
  Codex implementer).

**Exit condition:** The main agent can launch three workers concurrently and
provide one synthesized response when their reports arrive.

### Phase 3 — terminal UI and inspection (4–6 days)

- Build two-column layout, status badges, elapsed time, and live updates.
- Implement mouse-selectable agent sessions.
- Show selected-worker transcript, live tool events, final report, and errors
  in the central pane.
- Preserve main-agent-only input semantics.

**Exit condition:** Selecting a running or completed worker changes the central
inspection pane while messages still go to the main agent.

### Phase 4 — permission and profile controls (4–6 days)

- Implement global, profile, and task-level tool grants.
- Add user confirmation workflow for all extra privileges and policy edits.
- Translate permitted capabilities to each runtime's sandbox/approval settings.
- Add profile configuration through both files and main-agent requests.

**Exit condition:** A worker cannot receive elevated access without an explicit
user approval recorded in the local audit log.

### Phase 5 — hardening and release (6–10 days)

- Recover cleanly from interrupted Codex processes and partial event streams.
- Add integration tests using a fake provider plus end-to-end smoke tests for
  each installed provider adapter.
- Improve accessibility, mouse fallback, logging, setup flow, and documentation.
- Package a Linux installable CLI.

**Exit condition:** A new user can configure one or more providers, create a
session, run workers, approve a privilege escalation, and resume the session.

## Estimates

| Release level | Estimate |
| --- | ---: |
| Demonstrable prototype (Codex only, clickable inspection) | 1–2 weeks |
| Provider-neutral v1 (Codex + Claude, policy layer, all phases above) | 5–8 weeks |
| Each additional provider/runtime adapter | +3–7 days |
| Parallel write isolation via Git worktrees | +2–4 weeks |

These estimates assume one experienced developer, an already working local
provider installations/connections, and no remote sync or team features.

## Deliberate v1 constraints

- Linux only.
- Local-only sessions and storage.
- Codex and Claude are supported runtimes; future providers are adapters, not
  forks of the application.
- The main agent is the sole user-facing agent.
- Start with read-heavy parallelism. Restrict concurrent write-capable workers
  to one workspace until Git worktree isolation is added.
- Do not attempt to modify Codex's own native toolbar; tcode provides its own
  TUI around Codex.

## First build decision

Use TypeScript for the supervisor and adapter layer. Choose a Node TUI library
with explicit Linux terminal mouse support before Phase 3; do not choose the UI
framework solely because it is React-like if it cannot reliably receive mouse
events. Implement Codex first, then Claude, and do not expose provider-specific
state directly to the TUI.
