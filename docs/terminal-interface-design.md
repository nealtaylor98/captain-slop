# Terminal interface design directions

This document explores three terminal-native directions for Phase 3. All three
preserve one invariant: the composer always sends to the main agent. Selecting
a worker changes only the inspection pane.

## Shared scenarios and notation

The mockups use a 100-column desktop terminal unless marked otherwise. Status
is never communicated by color alone:

| Symbol | State                              | Text fallback               |
| ------ | ---------------------------------- | --------------------------- |
| `·`    | queued                             | `queued`                    |
| `▶`    | running                            | `running` plus elapsed time |
| `!`    | waiting for approval or a decision | `waiting`                   |
| `✓`    | completed                          | `done`                      |
| `×`    | failed                             | `failed`                    |
| `■`    | cancelled                          | `cancelled`                 |

The selected row uses a leading `>` and reverse video when available. Focus is
shown with a double border in these mockups, but an implementation may use a
high-contrast border plus a textual pane label. Streaming content ends with
`▌`; reduced-motion mode replaces it with `(streaming)`.

## Direction A — Supervisor split

A stable transcript/sidebar split closely follows the product plan. It favors
predictability: the session list never moves, the composer never moves, and
worker selection changes only the left pane.

### Main conversation

```text
┌ MAIN · conversation ───────────────────────────────────┬ AGENT SESSIONS ─────────────┐
│ You  Review the failing integration tests.             │ > ● Main          active    │
│                                                        │   · Test triage   queued    │
│ Main I started two workers and will combine results.   │   ▶ Explorer      01:12     │
│                                                        │   ! Implementer   waiting   │
│ TOOL spawn_worker  ✓  Test triage                      │   ✓ Docs          done      │
│ TOOL spawn_worker  ✓  Explorer                         │   × Lint fix      failed    │
│                                                        │   ■ Old run       cancelled │
│ Main Explorer found three likely causes…▌              │                          7/7 │
│                                                        │                              │
├────────────────────────────────────────────────────────┴──────────────────────────────┤
│ TO MAIN  Review the highest-confidence cause first.                         [Send ↵] │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Selected worker inspection

```text
┌ WORKER · Explorer · running 01:12 ─────────────────────┬ AGENT SESSIONS ─────────────┐
│ TASK Find likely causes of the integration failures.  │   ● Main          active    │
│                                                        │   · Test triage   queued    │
│ 10:31 Searching test/integration                       │ > ▶ Explorer      01:12     │
│ TOOL search_files                                      │   ! Implementer   waiting   │
│   query: "timeout"                                     │   ✓ Docs          done      │
│   result: 14 matches                         ✓ 0.2s     │   × Lint fix      failed    │
│ 10:32 Reading retry-policy.test.ts                      │   ■ Old run       cancelled │
│ Explorer The retry timer is not using the fake clock▌  │                          7/7 │
│                                                        │                              │
├────────────────────────────────────────────────────────┴──────────────────────────────┤
│ TO MAIN (inspecting Explorer) Ask it to verify the timer setup.             [Send ↵] │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Tool calls are one-line summaries by default; `Enter` expands the focused
event. Approval and error events render as bordered blocks with the plain-text
labels `APPROVAL REQUIRED` and `ERROR`. A completed worker ends with a
structured `REPORT` block containing status, summary, artifacts, changes, next
step, and escalation request.

## Direction B — Activity rail

This direction maximizes transcript width. The narrow right rail shows status,
short IDs, and truncated names; a details strip below the pane identifies the
selected session. It is useful for code-heavy output but makes the session list
less immediately legible.

### Main conversation

```text
┌ MAIN · conversation ──────────────────────────────────────────────────┬ SESSIONS ────┐
│ You  Review the failing integration tests.                            │ >● MAIN      │
│                                                                       │  · TRIAGE    │
│ Main I started two workers and will combine results.                  │  ▶ EXPLOR… 1m│
│                                                                       │  ! IMPLEM…   │
│ ├─ ✓ spawn Test triage                                                │  ✓ DOCS      │
│ └─ ✓ spawn Explorer                                                   │  × LINT      │
│ Main Explorer found three likely causes…▌                             │  ■ OLD       │
│                                                                       │        7/7   │
├───────────────────────────────────────────────────────────────────────┴──────────────┤
│ SELECTED Main · active · conversation                                                │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ TO MAIN  Type a message…                                                   [Send ↵] │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Selected worker inspection

```text
┌ EXPLORER · activity ──────────────────────────────────────────────────┬ SESSIONS ────┐
│ TASK Find likely causes of the integration failures.                 │  ● MAIN      │
│                                                                       │  · TRIAGE    │
│ 10:31 search_files "timeout"                              ✓ 14 hits   │ >▶ EXPLOR… 1m│
│ 10:32 read retry-policy.test.ts                           ✓ 120 lines  │  ! IMPLEM…   │
│ 10:32 shell npm test -- retry-policy                       running ▌  │  ✓ DOCS      │
│                                                                       │  × LINT      │
│ Explorer The retry timer is not using the fake clock…                 │  ■ OLD       │
│                                                                       │        7/7   │
├───────────────────────────────────────────────────────────────────────┴──────────────┤
│ SELECTED Explorer · running 01:12 · read-only · Esc cancel                           │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ TO MAIN (inspecting Explorer) Type a message…                              [Send ↵] │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The rail expands temporarily over the transcript with `Ctrl+B` or a mouse
click on its heading. This gives full names and state labels without changing
the persistent compact layout.

## Direction C — Session board

This direction turns the sidebar into grouped lanes. It makes lifecycle and
queue pressure easiest to scan, while leaving less space for transcripts and
requiring more rendering logic.

### Main conversation

```text
┌ MAIN · conversation ──────────────────────────────┬ SESSION BOARD ───────────────────┐
│ You  Review the failing integration tests.       │ MAIN                             │
│                                                   │ > ● Main · active                │
│ Main I started two workers.                       │ ACTIVE                           │
│                                                   │   ▶ Explorer · 01:12             │
│ ✓ Spawned Explorer                                │   ! Implementer · approval       │
│ ✓ Spawned Test triage                             │ QUEUED                           │
│                                                   │   · Test triage · #1             │
│ Main Explorer found three likely causes…▌        │ RECENT                           │
│                                                   │   ✓ Docs   × Lint   ■ Old        │
├───────────────────────────────────────────────────┴───────────────────────────────────┤
│ TO MAIN  Type a message…                                                   [Send ↵] │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

### Selected worker inspection

```text
┌ WORKER · Implementer ─────────────────────────────┬ SESSION BOARD ───────────────────┐
│ ! APPROVAL REQUIRED                              │ MAIN                             │
│   Run `npm install` with network access?          │   ● Main · active                │
│   Requested capability: network                   │ ACTIVE                           │
│   Ask the main agent to approve or deny.          │   ▶ Explorer · 01:12             │
│                                                   │ > ! Implementer · approval       │
│ Previous activity                                 │ QUEUED                           │
│ 10:32 read package.json                    ✓      │   · Test triage · #1             │
│ 10:33 shell npm install                    !      │ RECENT                           │
│                                                   │   ✓ Docs   × Lint   ■ Old        │
├───────────────────────────────────────────────────┴───────────────────────────────────┤
│ TO MAIN (inspecting Implementer) Deny; use the lockfile.                   [Send ↵] │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

Groups can collapse, and completed, failed, and cancelled workers are combined
under `RECENT` when space is scarce. Counts remain visible in collapsed group
headings, for example `RECENT (18)`.

## Comparison

| Direction           | Information density                                              | Readability                                                | Implementation complexity                                                 | Accessibility                                                                |
| ------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A. Supervisor split | Balanced; full names and useful transcript width at 100+ columns | Strong, stable geometry and explicit labels                | Low–medium; one responsive split and reusable event rows                  | Strong; state text fits, selection and focus are unambiguous                 |
| B. Activity rail    | Highest transcript density, lowest session detail                | Excellent for logs and code; abbreviations add lookup cost | Medium; compact/expanded rail and details strip must synchronize          | Fair; truncated labels and icon-heavy rail require expansion fallback        |
| C. Session board    | Highest lifecycle density, lowest transcript width               | Strong for many workers, busy for long conversations       | High; grouping, collapsing, count summaries, and responsive rearrangement | Good if groups expose text labels; more focus stops increase navigation cost |

Direction A is recommended. It most directly expresses the product's mental
model, has the fewest responsive modes, and remains understandable without
color or mouse support. Direction C's grouped summaries can be added later if
real workloads show that a flat virtualized list is insufficient.

## Recommended visual system

### Hierarchy and spacing

1. The top line names the selected context (`MAIN` or `WORKER`) and its state.
2. The central pane prioritizes conversation text or worker activity.
3. The sidebar is always visible and owns session selection.
4. The composer is always the bottommost region and begins with `TO MAIN`.

Use one blank row between message groups, one space inside borders, and two
spaces between sidebar name and metadata. Do not indent transcript bodies more
than two cells. Tool details indent two cells under a summary. Avoid boxes
inside boxes except for approvals, errors, and final reports, where enclosure
signals semantic importance.

At 100 columns or wider, allocate 70% to the content pane and 30% to a sidebar
of 24–34 columns. At 60–99 columns, fix the sidebar at 22 columns and truncate
session names with an ellipsis while retaining the full name in the selected
pane heading. At 40–59 columns, use the compact layout below. Below 40 columns,
show a clear minimum-size message while still allowing quit and help keys.

### Color

Color supplements labels and symbols:

| Role                  | Suggested ANSI color     | Required non-color cue                |
| --------------------- | ------------------------ | ------------------------------------- |
| running/streaming     | cyan                     | `▶`, `running`, or `(streaming)`      |
| waiting/approval      | yellow                   | `!` and `waiting`/`APPROVAL REQUIRED` |
| completed             | green                    | `✓` and `done`                        |
| failed/error          | red                      | `×` and `failed`/`ERROR`              |
| cancelled/dim history | default/dim              | `■` and `cancelled`                   |
| focus/selection       | reverse or bright border | `>` and pane title                    |

Honor `NO_COLOR`, detect limited color support, and provide a monochrome mode.
Never encode provider, state, selection, or severity using color alone. Avoid
rapid animation; update the running glyph at most twice per second and offer a
static reduced-motion mode.

### Keyboard and mouse

| Input                       | Action                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `Tab` / `Shift+Tab`         | Cycle composer, transcript, and session list focus                                        |
| `Ctrl+B`                    | Focus the session list; pressing it again returns to the prior pane                       |
| `j`/`k` or arrows           | Move within the focused transcript or session list                                        |
| `Enter`                     | Select a session or expand/collapse the focused event; send only when composer has focus  |
| `Home`/`End`, `PgUp`/`PgDn` | Navigate the focused virtualized list                                                     |
| `g m`                       | Select the main session                                                                   |
| `g s`                       | Select the session list                                                                   |
| `[` / `]`                   | Select previous/next session without moving focus                                         |
| `Ctrl+F`                    | Search the selected transcript                                                            |
| `?`                         | Open a keyboard help overlay                                                              |
| `Esc`                       | Close an overlay, cancel search, or request application exit when no transient UI is open |

A click selects and focuses a session. The mouse wheel scrolls the pane under
the pointer. Clicking a tool summary toggles its details. No essential action
requires hover, double-click, drag, or a mouse. Approvals are not approved by a
worker-pane button: the user communicates the decision through the main-agent
composer, preserving the authority model.

## Responsive and scale behavior

### Narrow terminal (52 × 18)

The sidebar remains visible as a four-column status rail. `Ctrl+B` toggles it
between rail and a temporary 22-column overlay; it does not disappear entirely.

```text
┌ WORKER · Explorer · running ───────────────────┬───┐
│ TASK Find causes of the integration failures. │●  │
│                                               │·  │
│ 10:31 search "timeout"              ✓ 14 hits │▶> │
│ 10:32 read retry-policy.test.ts             ✓ │!  │
│ Explorer The retry timer uses the real clock▌ │✓  │
│                                               │×  │
│                                               │■  │
├───────────────────────────────────────────────┴───┤
│ TO MAIN (Explorer)                                │
│ Ask it to verify the timer setup.                 │
│                                            [↵]    │
└───────────────────────────────────────────────────┘
```

The rail's selection marker and symbols remain visible. Its expanded overlay
provides full names and state text for screen-reader and monochrome use. The
composer grows to at most three rows, after which its text scrolls internally.

### Long transcripts

- Render transcript and activity entries as a virtualized list keyed by stable
  event ID; do not retain a terminal node for every historical line.
- Follow streaming output only while the viewport is at the bottom. Scrolling
  up pins the viewport and shows `↓ 12 new events`; `End` resumes follow mode.
- Collapse completed tool details by default while retaining tool name,
  outcome, duration, and one-line error text.
- Search includes collapsed content and marks the result count textually.

### Many workers

- Keep Main pinned first; sort workers by actionable waiting state, active,
  queued, and most recently finished. Do not reorder the row under keyboard
  focus; apply sorting after focus moves or the user confirms an update.
- Virtualize the session list and show `visible/total` at its bottom.
- Filter with `/` while the session list has focus. Provide state filters with
  explicit labels rather than colored tabs.
- Preserve selection by session ID when rows reorder, finish, or disappear
  from a filter.

## Implementation-ready specification for Direction A

### Component tree

```text
AppFrame
├── ContextPane
│   ├── PaneHeader
│   └── MainTranscript | WorkerInspection
│       ├── VirtualEventList
│       ├── ToolEventRow (expandable)
│       ├── ApprovalBlock | ErrorBlock
│       └── WorkerReportBlock
├── SessionSidebar
│   ├── MainSessionRow
│   ├── VirtualWorkerList
│   └── SessionCountAndFilter
├── MainComposer
│   ├── DestinationLabel
│   ├── MultilineInput
│   └── SendHint
└── OverlayHost (help, search, expanded narrow sidebar, exit confirmation)
```

`MainComposer` accepts no destination property. Its submit action always calls
`sendToMain(text)`. The selected session ID belongs to inspection state only,
so it cannot accidentally redirect user input.

### View state

```ts
type UiState = {
  selectedSessionId: SessionId; // inspection only
  focusedRegion: "context" | "sessions" | "composer";
  viewportBySession: Map<SessionId, ViewportState>;
  expandedEventIds: Set<EventId>;
  sessionFilter: { text: string; states: WorkerState[] };
  overlay: "none" | "help" | "search" | "session-list" | "exit";
  colorMode: "auto" | "mono";
  reducedMotion: boolean;
};
```

The domain-facing state remains provider-neutral. Sidebar rows consume session
ID, display name, role, lifecycle state, elapsed time, unread count, and whether
attention is required. Event rows consume normalized captain-slop event types,
not provider event payloads.

### Lifecycle rendering

| Lifecycle/event | Sidebar               | Context pane                                                            |
| --------------- | --------------------- | ----------------------------------------------------------------------- |
| queued          | `· name  queued (#n)` | task, queue position, cancel availability                               |
| running         | `▶ name  01:12`       | streaming text and active tool row                                      |
| waiting         | `! name  waiting`     | approval/decision block with requested capability and safe next action  |
| completed       | `✓ name  done`        | final structured report, with prior activity available                  |
| failed          | `× name  failed`      | persistent error summary, retry guidance, and partial report if present |
| cancelled       | `■ name  cancelled`   | cancellation source/time and retained partial activity                  |

Streaming text appends to the current text event rather than creating a row per
token. Tool activity progresses through requested, started, and finished states
in the same stable row. Errors and approvals remain visible after later events
arrive. Unread counts clear only when the session is selected and its viewport
reaches the newest event.

### Layout states and acceptance checks

| Width    | Layout                                   | Acceptance check                                        |
| -------- | ---------------------------------------- | ------------------------------------------------------- |
| `>= 100` | proportional split, 24–34 column sidebar | full state labels and composer destination visible      |
| `60–99`  | fixed 22-column sidebar                  | names truncate, status text remains                     |
| `40–59`  | four-column rail plus expandable overlay | sidebar is always visible and fully keyboard accessible |
| `< 40`   | minimum-size notice                      | help and exit remain operable; no corrupted drawing     |

Automated renderer tests should cover every lifecycle state in color and
monochrome modes, main and worker selection, narrow breakpoints, pinned-scroll
new-event counts, expanded/collapsed tools, and a composer submission while a
worker is selected. The last test must assert that the message is delivered to
the main session ID.

This direction is ready for Phase 3 implementation once the chosen Node TUI
library has verified support for mouse events, keyboard focus, Unicode-width
measurement, and incremental/virtualized rendering on Linux terminals.
