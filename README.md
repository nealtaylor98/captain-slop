# captain-slop

> **Vibe-coded work in progress:** this project is experimental, incomplete,
> and probably does not work yet. Expect bugs, missing features, and breaking
> changes.

`captain-slop` is a Linux terminal supervisor for coding agents. It keeps one main
agent available for the user while it delegates independent work to background
agent sessions. Providers such as Codex and Claude plug into the same UI,
policy, and local-session model.

See [PLAN.md](PLAN.md) for the implementation plan and
[docs/terminal-interface-design.md](docs/terminal-interface-design.md) for the
evaluated Phase 3 interface directions.

## Interface preview

![Worker inspection view](worker%20agent%20main%20window.png)

## Run

```bash
npm install
npm test
npm start
```

`npm start` opens the Codex-backed terminal UI using the existing local Codex
CLI login and its account-selected default model—no configuration file is
needed. Typing and Enter sends a message to the main agent. Press Ctrl-C or
Escape to exit.

The main conversation and its provider thread ID are saved locally after each
event. Restarting `captain-slop` restores the transcript and continues the same
provider thread on the next message. A startup retention check and daily job
remove conversations that have been inactive for more than 30 days.

`npm run demo` is the explicit fake-runtime layout preview for development and
tests; in a non-interactive shell it prints deterministically.

The Codex adapter uses an already-installed and configured local `codex` CLI;
it does not authenticate or set up credentials. Configuration is optional: a
`[profiles.main]` entry can override the default with
`node dist/src/app/main.js --config path/to/captain-slop.toml`.

Codex maps `workspace_write` to its `workspace-write` sandbox and all other
profiles to `read-only`. It cannot enforce individual captain-slop tool grants, so
that limitation is reported through runtime capabilities before use.

`npm run smoke:codex` is an explicit, non-sending readiness check: it only
prints the installed CLI version and local login status. It fails if the local
CLI is absent or not configured; it never starts an agent turn.

Use `npm run format` to apply Prettier or `npm run format:check` to verify
formatting without changing files.

## Local diagnostic logs

captain-slop writes structured JSON Lines diagnostic logs to
`$XDG_DATA_HOME/captain-slop/logs` (normally
`~/.local/share/captain-slop/logs`). These files are separate from saved
session transcripts and stay on the local machine; the application has no
telemetry or remote log transport.

The default `info` level records timestamps, components, event names, and
correlation metadata, but not prompts, message bodies, environment values,
credentials, tokens, or full command output. Sensitive fields are redacted at
the logger boundary. Logs rotate at 5 MiB, retain at most five files, and files
older than seven days are removed.

Temporarily enable local debug metadata with either
`captain-slop --debug-logging` or `CAPTAIN_SLOP_LOG_LEVEL=debug captain-slop`.
Debug logging is opt-in and uses the same redaction, rotation, and local-only
storage rules.

To attach a diagnostic bundle, first inspect the JSONL files for any contextual
values you consider sensitive, remove or replace those records, then archive
only the `logs` directory. Do not attach `state.json`, which contains session
transcripts. For example:

```bash
tar -czf captain-slop-diagnostics.tar.gz -C "${XDG_DATA_HOME:-$HOME/.local/share}/captain-slop" logs
```
