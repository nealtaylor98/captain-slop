import { mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { FakeRuntime } from "../runtimes/fake-runtime.js";
import type { AgentRuntime } from "../runtimes/types.js";
import { LocalStore } from "../storage/local-store.js";
import { SupervisorViewModel, mainChatLine, renderScreen } from "../tui/index.js";
import { TerminalUi } from "../tui/terminal-ui.js";
import { MainAgentController } from "./controller.js";
import { loadConfig } from "./config.js";
import { createRuntimes } from "./runtime-factory.js";
import { codexSmoke } from "./codex-smoke.js";
import { defaultMainProfile } from "./defaults.js";
import { initialAgents, initialTranscripts } from "./initial-view.js";

const demoProfile = { id: "main", provider: "fake", model: "local-demo", instructions: "Supervise workers and respond to the user.", allowedTools: ["read_file"] };

async function run(): Promise<void> {
  if (process.argv.includes("--codex-smoke")) {
    const runCommand = promisify(execFile);
    console.log(await codexSmoke(async (args) => (await runCommand("codex", args)).stdout));
    return;
  }
  const demo = process.argv.includes("--demo");
  const agents = initialAgents(demo);
  const transcripts = initialTranscripts(demo);
  const view = new SupervisorViewModel(agents, transcripts);
  if (demo && !process.stdout.isTTY) { console.log(renderScreen(view.snapshot(), 100, 18)); return; }
  const dataDir = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  await mkdir(join(dataDir, "tcode"), { recursive: true });
  const store = new LocalStore(join(dataDir, "tcode", "state.json")); await store.open(); await store.cleanup(Date.now());
  let profile = demo ? demoProfile : defaultMainProfile();
  let runtime: AgentRuntime = demo ? new FakeRuntime() : createRuntimes([profile]).get(profile.provider)!;
  const configFlag = process.argv.indexOf("--config");
  if (configFlag >= 0) {
    const path = process.argv[configFlag + 1];
    if (!path) throw new Error("--config requires a TOML path.");
    const config = loadConfig(await readFile(path, "utf8"));
    profile = config.profiles.find((candidate) => candidate.id === "main") ?? config.profiles[0] ?? (() => { throw new Error("Configuration contains no profiles."); })();
    const configuredRuntime = createRuntimes([profile]).get(profile.provider);
    if (!configuredRuntime) throw new Error(`No runtime adapter is available for provider: ${profile.provider}`);
    runtime = configuredRuntime;
  }
  let ui: TerminalUi | undefined;
  const controller = new MainAgentController(runtime, profile, async (event) => {
    view.handleRuntimeEvent(event);
    const line = mainChatLine(event);
    if (line) (transcripts.get("main") ?? []).push(line);
    await store.appendEvent("demo", { at: Date.now(), agentId: "main", event });
    ui?.refresh();
  });
  ui = new TerminalUi(view, (message) => {
    (transcripts.get("main") ?? []).push(`You: ${message}`); ui?.refresh();
    void controller.send(message)
      .catch((error: unknown) => { (transcripts.get("main") ?? []).push(`Assistant error: ${error instanceof Error ? error.message : String(error)}`); })
      .finally(() => { view.setAwaitingResponse(false); ui?.refresh(); });
  });
  ui.start();
}
void run();
