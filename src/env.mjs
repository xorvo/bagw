// PATH resolution. bagw spawns agent CLIs directly (no shell), so it needs a
// good PATH. Under `brew services` / launchd the process inherits only a minimal
// PATH — no ~/.local/bin, no nvm, no asdf — so `claude` (and its own helpers
// like a credential-refresh command) can't be found.
//
// Fix: at startup, ask the user's LOGIN SHELL for its PATH (the same PATH a
// terminal has) and merge it in. Falls back to common locations if that fails.

import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const MARKER = "__BAGW_PATH__";

// Run the login shell once and read its $PATH. A marker isolates the value from
// any other noise an rc file might print; a timeout guards against a hang.
export function loginShellPath() {
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    const r = spawnSync(shell, ["-lic", `printf '%s%s\\n' '${MARKER}' "$PATH"`], {
      encoding: "utf8",
      timeout: 5000,
    });
    const line = (r.stdout || "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith(MARKER));
    if (line) return line.slice(MARKER.length);
  } catch {}
  return "";
}

function commonDirs() {
  const home = homedir();
  return [
    join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
}

// Merge: login-shell PATH first (covers nvm/asdf/custom dirs), then common dirs,
// then whatever we already had. De-duplicated, order preserved.
export function augmentPath() {
  const parts = [];
  const add = (p) => {
    if (p && !parts.includes(p)) parts.push(p);
  };
  loginShellPath().split(":").forEach(add);
  commonDirs().forEach(add);
  (process.env.PATH || "").split(":").forEach(add);
  process.env.PATH = parts.filter(Boolean).join(":");
  return process.env.PATH;
}

// Resolve a binary the way exec would: absolute/relative path as-is, else search
// PATH. Returns the full path or null.
export function which(bin) {
  if (!bin) return null;
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  for (const dir of (process.env.PATH || "").split(":")) {
    if (!dir) continue;
    const p = join(dir, bin);
    try {
      if (existsSync(p) && statSync(p).isFile()) return p;
    } catch {}
  }
  return null;
}
