import { readFileSync, existsSync } from "node:fs";
import { CONFIG_FILE } from "./paths.mjs";

// Agents are pluggable. Each entry names an adapter `type` and adapter-specific
// fields. Claude Code is the built-in default; add more in ~/.bagw/config.json.
//
// Example config.json adding a generic command-based agent, and letting clients
// run it inside your projects:
// {
//   "defaultAgent": "claude",
//   "cwdRoots": ["~/projects"],
//   "agents": {
//     "claude": { "type": "claude-code", "bin": "claude" },
//     "codex":  { "type": "command", "command": ["codex", "exec", "--quiet"] }
//   }
// }
export const DEFAULT_CONFIG = {
  host: "127.0.0.1", // never change to 0.0.0.0 — keeps bagw off the network
  port: 8791,
  defaultAgent: "claude",
  rateLimitPerMin: 60, // per approved client
  pendingTtlMs: 5 * 60 * 1000,
  // Directories a client may ask the agent to run in. A client-supplied cwd
  // decides which files the agent can read, so it stays opt-in: empty means any
  // request for a working directory is refused and agents run in a temp dir.
  cwdRoots: [],
  agents: {
    claude: { type: "claude-code", bin: "claude" },
  },
};

export function loadConfig() {
  let cfg = { ...DEFAULT_CONFIG };
  if (existsSync(CONFIG_FILE)) {
    try {
      const u = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
      cfg = { ...cfg, ...u, agents: { ...cfg.agents, ...(u.agents || {}) } };
    } catch (e) {
      console.warn(`Ignoring invalid ${CONFIG_FILE}: ${e.message}`);
    }
  }
  if (process.env.BAGW_PORT) cfg.port = Number(process.env.BAGW_PORT);
  if (process.env.BAGW_HOST) cfg.host = process.env.BAGW_HOST;
  return cfg;
}
