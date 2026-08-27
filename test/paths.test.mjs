// Path resolution: BAGW_DIR > existing ~/.bagw > XDG. Run: npm test
//
// Resolution reads the environment at import time, so each case runs in its own
// child process with a fake HOME — getting the precedence wrong would silently
// orphan an existing install's paired clients.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PATHS = new URL("../src/paths.mjs", import.meta.url).pathname;

function resolveIn(env) {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { CONFIG_FILE, CLIENTS_FILE, LOG_FILE, legacyDirWarning } from ${JSON.stringify(PATHS)};
       console.log(JSON.stringify({ CONFIG_FILE, CLIENTS_FILE, LOG_FILE, warning: legacyDirWarning() }));`,
    ],
    { env: { PATH: process.env.PATH, ...env }, encoding: "utf8" }
  );
  return JSON.parse(out);
}

const home = mkdtempSync(join(tmpdir(), "bagw-home-"));

// New install, nothing set: the XDG layout, config and state kept apart.
let p = resolveIn({ HOME: home });
assert.equal(p.CONFIG_FILE, join(home, ".config", "bagw", "config.json"));
assert.equal(p.CLIENTS_FILE, join(home, ".local", "state", "bagw", "clients.json"));
assert.equal(p.LOG_FILE, join(home, ".local", "state", "bagw", "bagw.log"));

// XDG_* honoured when absolute.
p = resolveIn({
  HOME: home,
  XDG_CONFIG_HOME: "/tmp/xdgcfg",
  XDG_STATE_HOME: "/tmp/xdgstate",
});
assert.equal(p.CONFIG_FILE, "/tmp/xdgcfg/bagw/config.json");
assert.equal(p.CLIENTS_FILE, "/tmp/xdgstate/bagw/clients.json");

// A relative XDG_* value is ignored, per the spec.
p = resolveIn({ HOME: home, XDG_CONFIG_HOME: "relative/cfg" });
assert.equal(p.CONFIG_FILE, join(home, ".config", "bagw", "config.json"));

// A leftover ~/.bagw is ignored, not read — but it must produce a warning, since
// silently ignoring it looks exactly like lost config and revoked clients.
const legacyHome = mkdtempSync(join(tmpdir(), "bagw-legacy-"));
mkdirSync(join(legacyHome, ".bagw"));
p = resolveIn({ HOME: legacyHome });
assert.equal(p.CONFIG_FILE, join(legacyHome, ".config", "bagw", "config.json"));
assert.equal(p.CLIENTS_FILE, join(legacyHome, ".local", "state", "bagw", "clients.json"));
assert.match(p.warning || "", /no longer read/);
assert.match(p.warning, /rmdir/);

// No leftover directory, no warning.
assert.equal(resolveIn({ HOME: home }).warning, null);

// BAGW_DIR means the user chose a single directory on purpose — don't nag.
assert.equal(resolveIn({ HOME: legacyHome, BAGW_DIR: "/tmp/oneplace" }).warning, null);

// BAGW_DIR beats everything, including a legacy directory.
p = resolveIn({ HOME: legacyHome, BAGW_DIR: "/tmp/oneplace", XDG_CONFIG_HOME: "/tmp/xdgcfg" });
assert.equal(p.CONFIG_FILE, "/tmp/oneplace/config.json");
assert.equal(p.CLIENTS_FILE, "/tmp/oneplace/clients.json");
assert.equal(p.LOG_FILE, "/tmp/oneplace/bagw.log");

console.log("path resolution: all checks passed");
