#!/usr/bin/env node
// bagw — Browser Agent Gateway CLI.

import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { start, VERSION } from "../src/server.mjs";
import { install, uninstall } from "../src/service.mjs";
import { augmentPath, which, loginShellPath } from "../src/env.mjs";
import * as store from "../src/store.mjs";

const [cmd, ...rest] = process.argv.slice(2);

function fmtClient(c) {
  const last = c.lastUsedAt ? c.lastUsedAt.replace("T", " ").slice(0, 19) : "never";
  return `  ${c.name}\n    id: ${c.id}   calls: ${c.calls || 0}   last used: ${last}`;
}

async function status(config) {
  try {
    const res = await fetch(`http://${config.host}:${config.port}/health`);
    const d = await res.json();
    console.log(`bagw is running at http://${config.host}:${config.port}`);
    console.log(`version: ${d.version}   agents: ${(d.agents || []).join(", ")}`);
  } catch {
    console.log(`bagw does not appear to be running on ${config.host}:${config.port}.`);
    console.log(`Start it with: bagw start   (or install it: bagw install)`);
  }
  const clients = store.listClients();
  console.log(`approved clients: ${clients.length}`);
}

function help() {
  console.log(`bagw ${VERSION} — Browser Agent Gateway

Usage: bagw <command>

  start              Run the gateway in the foreground
  install            Install + start as a login service (macOS launchd)
  uninstall          Remove the login service
  status             Show whether bagw is running and list clients
  doctor             Check PATH + that each agent's binary can be found
  clients [--pending]  List approved clients (or pending pairing requests)
  approve <code>     Approve a pending pairing request (e.g. bagw approve A1B2-C3D4)
  deny <code>        Deny a pending pairing request
  revoke <name|id>   Revoke an approved client's access
  help               Show this help
  version            Print version

Config + state live in ~/.bagw/. The gateway runs your installed agents
(Claude Code by default) in a locked-down, no-tools, single-turn mode.`);
}

const config = loadConfig();
const now = () => new Date().toISOString();

switch (cmd) {
  case "start":
    start(config);
    break;
  case "install":
    install(fileURLToPath(import.meta.url));
    break;
  case "uninstall":
    uninstall();
    break;
  case "status":
    await status(config);
    break;
  case "doctor": {
    const before = process.env.PATH || "";
    augmentPath();
    console.log(`shell: ${process.env.SHELL || "(unset, defaulting to /bin/zsh)"}`);
    console.log(`login-shell PATH resolved: ${loginShellPath() ? "yes" : "no (using fallback dirs)"}`);
    console.log(`PATH augmented: ${process.env.PATH !== before ? "yes" : "no change"}`);
    console.log("agents:");
    for (const [id, def] of Object.entries(config.agents)) {
      const bin = def.bin || (Array.isArray(def.command) ? def.command[0] : "(none)");
      const found = which(bin);
      console.log(`  ${id} (${def.type}): ${bin} -> ${found || "NOT FOUND"}`);
    }
    break;
  }
  case "clients": {
    if (rest.includes("--pending")) {
      const pend = store.listPending(config.pendingTtlMs);
      if (!pend.length) console.log("No pending pairing requests.");
      else
        pend.forEach((p) =>
          console.log(`  ${p.code}  "${p.name}"  (${p.status})  id=${p.pairingId}`)
        );
    } else {
      const clients = store.listClients();
      if (!clients.length) console.log("No approved clients yet.");
      else clients.forEach((c) => console.log(fmtClient(c)));
    }
    break;
  }
  case "approve": {
    const code = rest[0];
    if (!code) {
      console.error("Usage: bagw approve <code>");
      process.exit(1);
    }
    const r = store.approve(code, now());
    if (r) console.log(`Approved "${r.client.name}". The client can now connect.`);
    else console.error(`No pending request matching "${code}".`);
    break;
  }
  case "deny": {
    const code = rest[0];
    if (!code) {
      console.error("Usage: bagw deny <code>");
      process.exit(1);
    }
    console.log(store.deny(code) ? "Denied." : `No pending request matching "${code}".`);
    break;
  }
  case "revoke": {
    const key = rest[0];
    if (!key) {
      console.error("Usage: bagw revoke <name|id>");
      process.exit(1);
    }
    const n = store.revoke(key);
    console.log(n ? `Revoked ${n} client(s).` : `No client matching "${key}".`);
    break;
  }
  case "version":
  case "--version":
  case "-v":
    console.log(VERSION);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    help();
    break;
  default:
    console.error(`Unknown command: ${cmd}\n`);
    help();
    process.exit(1);
}
