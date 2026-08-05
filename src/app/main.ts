import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { FakeRuntime } from "../runtimes/fake-runtime.js";
import type { AgentRuntime } from "../runtimes/types.js";
import { LocalStore } from "../storage/local-store.js";
import { SupervisorViewModel, mainChatLine, renderScreen } from "../tui/index.js";
import { TerminalUi } from "../tui/terminal-ui.js";
import { loadConfig } from "./config.js";
import { createRuntimes } from "./runtime-factory.js";
import { codexSmoke } from "./codex-smoke.js";
import { defaultMainProfile } from "./defaults.js";
import { initialAgents, initialTranscripts } from "./initial-view.js";
import { MainSession } from "./main-session.js";
import { ensureDataDirectory } from "./data-directory.js";

const demoProfile = {
  id: "main",
  provider: "fake",
  model: "local-demo",
  instructions: "Supervise workers and respond to the user.",
  allowedTools: ["read_file"],
};

async function run(): Promise<void> {
  if (process.argv.includes("--codex-smoke")) {
    const runCommand = promisify(execFile);
    console.log(await codexSmoke(async (args) => (await runCommand("codex", args)).stdout));
    return;
  }
  const demo = process.argv.includes("--demo");
  if (demo && !process.stdout.isTTY) {
    const view = new SupervisorViewModel(initialAgents(true), initialTranscripts(true));
    console.log(renderScreen(view.snapshot(), 100, 18));
    return;
  }
  const dataDir = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  const productDataDir = await ensureDataDirectory(dataDir);
  const store = new LocalStore(join(productDataDir, "state.json"));
  await store.open();
  await MainSession.startRetention(store);
  let profile = demo ? demoProfile : defaultMainProfile();
  let runtime: AgentRuntime = demo
    ? new FakeRuntime()
    : createRuntimes([profile]).get(profile.provider)!;
  const configFlag = process.argv.indexOf("--config");
  if (configFlag >= 0) {
    const path = process.argv[configFlag + 1];
    if (!path) throw new Error("--config requires a TOML path.");
    const config = loadConfig(await readFile(path, "utf8"));
    profile =
      config.profiles.find((candidate) => candidate.id === "main") ??
      config.profiles[0] ??
      (() => {
        throw new Error("Configuration contains no profiles.");
      })();
    const configuredRuntime = createRuntimes([profile]).get(profile.provider);
    if (!configuredRuntime)
      throw new Error(`No runtime adapter is available for provider: ${profile.provider}`);
    runtime = configuredRuntime;
  }
  const agents = initialAgents(demo);
  const transcripts = initialTranscripts(demo);
  let ui: TerminalUi | undefined;
  let view: SupervisorViewModel;
  const session = await MainSession.open(store, runtime, profile, Date.now, (event) => {
    view.handleRuntimeEvent(event);
    const line = mainChatLine(event);
    if (line) (transcripts.get("main") ?? []).push(line);
    ui?.refresh();
  });
  transcripts.set("main", session.transcript());
  view = new SupervisorViewModel(agents, transcripts);
  ui = new TerminalUi(view, (message) => {
    (transcripts.get("main") ?? []).push(`You: ${message}`);
    ui?.refresh();
    void session
      .send(message)
      .catch((error: unknown) => {
        (transcripts.get("main") ?? []).push(
          `Assistant error: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        view.setAwaitingResponse(false);
        ui?.refresh();
      });
  });
  ui.start();
}
void run();
