// Install bagw as a per-user background service that starts at login.
// macOS: launchd LaunchAgent. (Linux/Windows: run `bagw start` under your own
// supervisor — systemd user unit, pm2, a tmux pane, etc.)

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SERVICE_LABEL, LOG_FILE, DIR } from "./paths.mjs";

function plistPath() {
  return join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
}

// launchd gives processes a minimal PATH, so `claude` (often in ~/.local/bin)
// wouldn't be found. Seed a sensible PATH that includes the usual locations.
function servicePath() {
  const parts = [
    join(homedir(), ".local/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  return parts.join(":");
}

export function install(scriptPath) {
  if (process.platform !== "darwin") {
    console.log(
      "Auto-install is macOS-only. On Linux/Windows, run `bagw start` under your\n" +
        "own supervisor (systemd user unit, pm2, a tmux pane, etc.)."
    );
    return false;
  }
  mkdirSync(DIR, { recursive: true });
  mkdirSync(join(homedir(), "Library", "LaunchAgents"), { recursive: true });

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${scriptPath}</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${servicePath()}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_FILE}</string>
  <key>StandardErrorPath</key><string>${LOG_FILE}</string>
</dict>
</plist>
`;
  const p = plistPath();
  writeFileSync(p, plist);
  spawnSync("launchctl", ["unload", p], { stdio: "ignore" });
  const r = spawnSync("launchctl", ["load", p], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`launchctl load failed: ${r.stderr || r.stdout}`);
    return false;
  }
  console.log(`Installed and started bagw as a login service (${SERVICE_LABEL}).`);
  console.log(`Plist: ${p}`);
  console.log(`Logs:  ${LOG_FILE}`);
  return true;
}

export function uninstall() {
  if (process.platform !== "darwin") {
    console.log("Auto-install is macOS-only; nothing to uninstall here.");
    return false;
  }
  const p = plistPath();
  if (existsSync(p)) {
    spawnSync("launchctl", ["unload", p], { stdio: "ignore" });
    rmSync(p);
    console.log(`Removed login service (${SERVICE_LABEL}).`);
  } else {
    console.log("No bagw login service was installed.");
  }
  return true;
}
