import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// Where things live, in order of precedence:
//
//   1. BAGW_DIR — everything in one directory (used by tests, and handy if you
//      want a self-contained install).
//   2. XDG layout — config where you'd back it up, state (client tokens, log)
//      where you wouldn't.
//
// Per the XDG spec, a relative XDG_* value is ignored in favour of the default.
function xdgHome(envVar, fallback) {
  const v = process.env[envVar];
  return v && isAbsolute(v) ? v : join(homedir(), fallback);
}

// Pre-0.4 location. Not read any more — only used to warn that files are sitting
// somewhere bagw ignores, which would otherwise look like lost pairings.
export const LEGACY_DIR = join(homedir(), ".bagw");

const singleDir = process.env.BAGW_DIR || null;

export const CONFIG_DIR = singleDir || join(xdgHome("XDG_CONFIG_HOME", ".config"), "bagw");
export const STATE_DIR =
  singleDir || join(xdgHome("XDG_STATE_HOME", join(".local", "state")), "bagw");

export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const CLIENTS_FILE = join(STATE_DIR, "clients.json");
export const LOG_FILE = join(STATE_DIR, "bagw.log");

export const SERVICE_LABEL = "dev.bagw";

// A leftover ~/.bagw is silent otherwise: config appears to vanish and paired
// clients look revoked. Say so instead, with the two commands that fix it.
export function legacyDirWarning() {
  if (process.env.BAGW_DIR || !existsSync(LEGACY_DIR)) return null;
  return [
    `WARNING: ${LEGACY_DIR} still exists and is no longer read (bagw 0.4+).`,
    `  mv ${LEGACY_DIR}/config.json ${CONFIG_FILE}`,
    `  mv ${LEGACY_DIR}/clients.json ${LEGACY_DIR}/bagw.log ${STATE_DIR}/`,
    `  then: rmdir ${LEGACY_DIR}`,
  ].join("\n");
}
