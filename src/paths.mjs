import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// Where things live, in order of precedence:
//
//   1. BAGW_DIR — everything in one directory (used by tests, and handy if you
//      want a self-contained install).
//   2. ~/.bagw — if it already exists. Upgrades must not orphan your paired
//      clients, so an existing legacy directory keeps being used as-is.
//   3. XDG layout — for new installs: config where you'd back it up, state
//      (client tokens, log) where you wouldn't.
//
// Per the XDG spec, a relative XDG_* value is ignored in favour of the default.
function xdgHome(envVar, fallback) {
  const v = process.env[envVar];
  return v && isAbsolute(v) ? v : join(homedir(), fallback);
}

const LEGACY_DIR = join(homedir(), ".bagw");
const singleDir = process.env.BAGW_DIR || (existsSync(LEGACY_DIR) ? LEGACY_DIR : null);

export const CONFIG_DIR = singleDir || join(xdgHome("XDG_CONFIG_HOME", ".config"), "bagw");
export const STATE_DIR =
  singleDir || join(xdgHome("XDG_STATE_HOME", join(".local", "state")), "bagw");

export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const CLIENTS_FILE = join(STATE_DIR, "clients.json");
export const LOG_FILE = join(STATE_DIR, "bagw.log");

export const SERVICE_LABEL = "dev.bagw";
