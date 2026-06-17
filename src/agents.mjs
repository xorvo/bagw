// Agent adapters. Each adapter runs a locally-installed agent in a locked-down,
// completion-only way (no tools, single turn, neutral working directory) and
// returns plain text. Claude Code is built in; add more via config (see config.mjs).

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

function spawnText(bin, args, { stdin = "", cwd = tmpdir() } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { cwd, env: process.env });
    } catch (e) {
      reject(e);
      return;
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      if (e.code === "ENOENT")
        reject(
          new Error(
            `Couldn't find '${bin}' on PATH. Install it, or set the agent's "bin" to a full path.`
          )
        );
      else reject(e);
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err.trim() || `${bin} exited with code ${code}`));
      else resolve(out);
    });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

// Claude Code adapter — completion-only:
//   -p                       print mode (non-interactive)
//   --output-format json     machine-readable
//   --max-turns 1            single turn
//   --tools ""               disable ALL tools (no bash/edit/read/web)
//   --setting-sources user   apply ~/.claude/settings.json (Bedrock env +
//                            awsAuthRefresh) but NOT arbitrary project settings
//   --system-prompt <s>      fully replace the default coding-agent persona
//   --model <m>              optional override
async function runClaudeCode(def, { system, user, model }) {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--max-turns",
    "1",
    "--tools",
    "",
    "--setting-sources",
    "user",
  ];
  if (system) args.push("--system-prompt", system);
  if (model) args.push("--model", model);

  const raw = await spawnText(def.bin || "claude", args, { stdin: user });
  let text = raw.trim();
  try {
    const obj = JSON.parse(text);
    if (obj.is_error) throw new Error(obj.result || "agent reported an error");
    if (typeof obj.result === "string") text = obj.result;
  } catch (e) {
    if (e instanceof SyntaxError) {
      // not JSON — pass raw stdout through; caller parses leniently
    } else {
      throw e;
    }
  }
  return text;
}

// Generic command adapter — for any CLI that reads a prompt on stdin and prints
// text on stdout. `{model}` in the args is substituted (and dropped if blank).
async function runCommand(def, { system, user, model }) {
  if (!Array.isArray(def.command) || !def.command.length)
    throw new Error(`Agent "${def.type}" needs a non-empty "command" array.`);
  const [bin, ...rest] = def.command;
  const args = rest
    .map((a) => (a === "{model}" ? model : a))
    .filter((a) => a !== undefined && a !== "");
  const prompt = system ? `${system}\n\n${user}` : user;
  const raw = await spawnText(bin, args, { stdin: prompt });
  if (def.resultJsonPath) {
    try {
      const obj = JSON.parse(raw);
      const val = def.resultJsonPath
        .split(".")
        .reduce((o, k) => (o == null ? o : o[k]), obj);
      if (typeof val === "string") return val;
    } catch {}
  }
  return raw.trim();
}

const ADAPTERS = {
  "claude-code": runClaudeCode,
  command: runCommand,
};

export async function runAgent(config, { agent, system, user, model }) {
  const id = agent || config.defaultAgent;
  const def = config.agents[id];
  if (!def) throw new Error(`Unknown agent "${id}".`);
  const adapter = ADAPTERS[def.type];
  if (!adapter) throw new Error(`No adapter for agent type "${def.type}".`);
  return adapter(def, { system, user, model });
}

export function listAgents(config) {
  return Object.keys(config.agents);
}
