// Agent adapters. Each adapter runs a locally-installed agent in a locked-down,
// completion-only way (no tools, single turn, and a temp working directory unless
// the client asks for one you've allowed) and returns plain text. Claude Code is
// built in; add more via config (see config.mjs).

import { spawn } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, sep } from "node:path";

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

function expandHome(p) {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function badRequest(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

// A client-supplied working directory is a trust boundary: it decides which files
// the agent can read while answering. So it must sit inside one of the configured
// cwdRoots, and both sides are realpath'd first — that closes `..` traversal and
// symlinks pointing out of an allowed root. No roots configured = feature off.
export function resolveCwd(config, cwd) {
  if (!cwd) return tmpdir();

  const roots = (config.cwdRoots || []).map(expandHome);
  if (!roots.length)
    throw badRequest(
      'A working directory was requested but no "cwdRoots" are configured. Add e.g. ' +
        '{"cwdRoots": ["~/projects"]} to ~/.bagw/config.json to allow it.'
    );

  const requested = expandHome(String(cwd));
  if (!isAbsolute(requested))
    throw badRequest(`Working directory must be an absolute path, got "${cwd}".`);

  let real;
  try {
    real = realpathSync(requested);
    if (!statSync(real).isDirectory())
      throw badRequest(`Working directory is not a directory: ${requested}`);
  } catch (e) {
    if (e.status) throw e;
    throw badRequest(`Working directory doesn't exist: ${requested}`);
  }

  const allowed = roots.some((root) => {
    let realRoot;
    try {
      realRoot = realpathSync(expandHome(root));
    } catch {
      return false; // a root that doesn't exist allows nothing
    }
    return real === realRoot || real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep);
  });
  if (!allowed)
    throw badRequest(`Working directory ${real} is outside the allowed cwdRoots.`);

  return real;
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
async function runClaudeCode(def, { system, user, model, cwd }) {
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

  const raw = await spawnText(def.bin || "claude", args, { stdin: user, cwd });
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

// Substitute `{model}` in an agent's args. When no model is set the placeholder
// goes away — and so does the flag it belonged to, since `codex exec -m` with
// nothing after it is an error, not a default.
export function buildCommandArgs(rest, model) {
  const args = [];
  for (const a of rest) {
    if (a === undefined || a === "") continue;
    if (a !== "{model}") {
      args.push(a);
      continue;
    }
    if (model) {
      args.push(model);
    } else if (args.length && String(args[args.length - 1]).startsWith("-")) {
      args.pop();
    }
  }
  return args;
}

// Generic command adapter — for any CLI that reads a prompt on stdin and prints
// text on stdout. `{model}` in the args is substituted (and dropped if blank).
// The CLI is spawned in `cwd`, so tools like codex pick it up as their root.
async function runCommand(def, { system, user, model, cwd }) {
  if (!Array.isArray(def.command) || !def.command.length)
    throw new Error(`Agent "${def.type}" needs a non-empty "command" array.`);
  const [bin, ...rest] = def.command;
  const args = buildCommandArgs(rest, model);
  const prompt = system ? `${system}\n\n${user}` : user;
  const raw = await spawnText(bin, args, { stdin: prompt, cwd });
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

export async function runAgent(config, { agent, system, user, model, cwd }) {
  const id = agent || config.defaultAgent;
  const def = config.agents[id];
  if (!def) throw new Error(`Unknown agent "${id}".`);
  const adapter = ADAPTERS[def.type];
  if (!adapter) throw new Error(`No adapter for agent type "${def.type}".`);
  return adapter(def, { system, user, model, cwd: resolveCwd(config, cwd) });
}

export function listAgents(config) {
  return Object.keys(config.agents);
}
