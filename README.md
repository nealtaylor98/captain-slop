# tcode

`tcode` is a Linux terminal supervisor for coding agents. It keeps one main
agent available for the user while it delegates independent work to background
agent sessions. Providers such as Codex and Claude plug into the same UI,
policy, and local-session model.

See [PLAN.md](PLAN.md) for the implementation plan.

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

`npm run demo` is the explicit fake-runtime layout preview for development and
tests; in a non-interactive shell it prints deterministically.

The Codex adapter uses an already-installed and configured local `codex` CLI;
it does not authenticate or set up credentials. Configuration is optional: a
`[profiles.main]` entry can override the default with
`node dist/src/app/main.js --config path/to/tcode.toml`.

Codex maps `workspace_write` to its `workspace-write` sandbox and all other
profiles to `read-only`. It cannot enforce individual tcode tool grants, so
that limitation is reported through runtime capabilities before use.

`npm run smoke:codex` is an explicit, non-sending readiness check: it only
prints the installed CLI version and local login status. It fails if the local
CLI is absent or not configured; it never starts an agent turn.
