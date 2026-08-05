import type { AgentProfile, ToolName } from "../domain/index.js";

export interface AppConfig {
  globalTools: ToolName[];
  profiles: AgentProfile[];
}
const value = (line: string): string =>
  line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^"|"$/g, "");
const array = (raw: string): string[] =>
  raw.match(/"[^"]+"/g)?.map((item) => item.slice(1, -1)) ?? [];
export function loadConfig(toml: string): AppConfig {
  const config: AppConfig = { globalTools: [], profiles: [] };
  let current: Partial<AgentProfile> | undefined;
  const finish = () => {
    if (current?.id && current.provider && current.model)
      config.profiles.push({
        id: current.id,
        provider: current.provider,
        model: current.model,
        instructions: current.instructions ?? "",
        allowedTools: current.allowedTools ?? [],
      });
  };
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[tools.global]") {
      finish();
      current = undefined;
      continue;
    }
    const header = line.match(/^\[profiles?\.([^\]]+)\]$/);
    if (header) {
      finish();
      current = { id: header[1], allowedTools: [] };
      continue;
    }
    if (line.startsWith("globalTools") || (!current && line.startsWith("allowed"))) {
      config.globalTools = array(value(line));
      continue;
    }
    if (!current) continue;
    if (line.startsWith("allowedTools")) current.allowedTools = array(value(line));
    else if (line.includes("=")) {
      const key = line.slice(0, line.indexOf("=")).trim() as "provider" | "model" | "instructions";
      current[key] = value(line) as never;
    }
  }
  finish();
  return config;
}
