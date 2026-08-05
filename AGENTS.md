# Repository guidance

## Scope and architecture

- `captain-slop` is a standalone Linux terminal supervisor, not a Codex TUI plugin.
- Keep provider-specific code inside `src/runtimes/`. Domain, scheduler,
  storage, policy, and TUI code must use only captain-slop-owned neutral types.
- Preserve the main-agent-only user input model. Worker panes are inspection
  views; workers return structured reports to the main agent.
- Keep dependencies small. Prefer built-in Node facilities and TypeScript.
- Read `README.md` and `PLAN.md` before meaningful changes. Do not overwrite
  planning documents.

## Required red/green TDD workflow

Every meaningful behavior change must follow red/green TDD:

1. Add or change a focused test that expresses the intended behavior.
2. Run that test or `npm test` and confirm it fails for the expected reason.
3. Make the smallest implementation change that makes it pass.
4. Refactor only when it improves clarity, while keeping tests green.

Do not submit code diffs without corresponding tests unless the change is
strictly documentation, formatting, or build metadata with no behavior.

## Verification

Run these before handing off implementation work:

```bash
npm test
npm run check
npm run lint
```

For Codex adapter changes, also run the non-sending readiness check:

```bash
npm run smoke:codex
```

Only run a real provider prompt when the task requires it and a local Codex
login is already configured. Never attempt to create credentials or bypass
provider sandboxes. Clearly report limitations a provider cannot enforce.

## Local data and safety

- Session data remains local under the user data directory; do not add remote
  sync or telemetry.
- Do not add real API keys to source, fixtures, logs, or commits.
- Preserve uncommitted user changes and avoid destructive Git commands.
