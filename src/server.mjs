import http from "node:http";
import { appendFileSync, readFileSync } from "node:fs";
import { LOG_FILE } from "./paths.mjs";
import * as store from "./store.mjs";
import { showApprovalDialog, canShowDialog } from "./approve.mjs";
import { runAgent, listAgents } from "./agents.mjs";
import { augmentPath, which } from "./env.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
export const VERSION = pkg.version;

function log(line) {
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {}
}

// Only the browser extension (a chrome-extension:// origin) may read responses.
// Web pages get no CORS headers, and authenticated calls require a Bearer token
// (a non-simple header) which forces a preflight we don't approve for web origins.
function corsOrigin(req) {
  const o = req.headers.origin || "";
  return o.startsWith("chrome-extension://") ? o : null;
}
function setCors(res, origin) {
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
}
function send(res, status, obj, origin) {
  setCors(res, origin);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => {
      d += c;
      if (d.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}
function bearer(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

export function createServer(config) {
  const rate = new Map(); // clientId -> timestamps (ms) within the last minute

  function rateLimited(clientId) {
    const now = Date.now();
    const arr = (rate.get(clientId) || []).filter((t) => now - t < 60_000);
    if (arr.length >= config.rateLimitPerMin) {
      rate.set(clientId, arr);
      return true;
    }
    arr.push(now);
    rate.set(clientId, arr);
    return false;
  }

  return http.createServer(async (req, res) => {
    const origin = corsOrigin(req);
    const url = new URL(req.url, "http://localhost");
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      setCors(res, origin);
      res.writeHead(204);
      res.end();
      return;
    }

    // Health — no auth.
    if (req.method === "GET" && path === "/health") {
      send(res, 200, { ok: true, service: "bagw", version: VERSION, agents: listAgents(config) }, origin);
      return;
    }

    // Start a pairing request. No token yet — requires user approval.
    if (req.method === "POST" && path === "/pair") {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch {
        send(res, 400, { error: "Invalid JSON body." }, origin);
        return;
      }
      const agent = body.agent || config.defaultAgent;
      const p = store.createPending(body.name, config.pendingTtlMs, new Date().toISOString());
      log(`PAIR request "${p.name}" code=${p.code} id=${p.pairingId}`);

      // Native dialog (macOS); otherwise the user approves via the CLI.
      showApprovalDialog(
        { name: p.name, agent, code: p.code },
        () => {
          store.approve(p.pairingId, new Date().toISOString());
          log(`PAIR approved (dialog) "${p.name}" id=${p.pairingId}`);
        },
        (reason) => {
          if (reason === "denied") {
            store.deny(p.pairingId);
            log(`PAIR denied (dialog) "${p.name}" id=${p.pairingId}`);
          }
          // "no-gui"/spawn errors: leave pending for `bagw approve <code>`
        }
      );

      send(
        res,
        200,
        {
          pairingId: p.pairingId,
          code: p.code,
          approval: canShowDialog() ? "dialog" : "cli",
          message: canShowDialog()
            ? "Approve the dialog on the machine running bagw."
            : `Approve on the machine running bagw:  bagw approve ${p.code}`,
        },
        origin
      );
      return;
    }

    // Poll pairing status; returns the token once, after approval.
    if (req.method === "GET" && path.startsWith("/pair/")) {
      const id = decodeURIComponent(path.slice("/pair/".length));
      const result = store.claimToken(id);
      send(res, 200, result, origin);
      return;
    }

    // Run an agent. Requires an approved per-client token.
    if (req.method === "POST" && path === "/invoke") {
      const client = store.findClientByToken(bearer(req));
      if (!client) {
        send(res, 401, { error: "Not paired. Request access first (the extension will prompt you to approve)." }, origin);
        return;
      }
      if (rateLimited(client.id)) {
        send(res, 429, { error: "Rate limit exceeded. Try again shortly." }, origin);
        return;
      }
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "{}");
      } catch {
        send(res, 400, { error: "Invalid JSON body." }, origin);
        return;
      }
      if (!body.user) {
        send(res, 400, { error: "Missing 'user' field." }, origin);
        return;
      }
      const agent = body.agent || config.defaultAgent;
      const started = Date.now();
      try {
        const text = await runAgent(config, {
          agent,
          system: body.system || "",
          user: body.user,
          model: body.model || "",
        });
        store.recordUse(client.id, new Date().toISOString());
        log(`INVOKE ok client="${client.name}" agent=${agent} ${Date.now() - started}ms`);
        send(res, 200, { ok: true, text, agent }, origin);
      } catch (e) {
        log(`INVOKE error client="${client.name}" agent=${agent}: ${e?.message || e}`);
        send(res, 500, { error: e?.message || String(e) }, origin);
      }
      return;
    }

    send(res, 404, { error: "Not found." }, origin);
  });
}

export function start(config) {
  // Make spawned agent CLIs findable even under launchd's minimal PATH.
  augmentPath();

  const server = createServer(config);
  server.listen(config.port, config.host, () => {
    log(`START listening on ${config.host}:${config.port}`);
    console.log(`bagw ${VERSION} listening at http://${config.host}:${config.port}`);
    console.log(`Agents: ${listAgents(config).join(", ")}`);

    // Warn loudly if a configured agent's binary can't be found.
    for (const [id, def] of Object.entries(config.agents)) {
      const bin = def.bin || (Array.isArray(def.command) ? def.command[0] : null);
      if (bin && !which(bin)) {
        const msg = `WARNING: agent "${id}" binary "${bin}" not found on PATH.`;
        console.warn(msg);
        log(msg);
      }
    }
    console.log(`Approve new clients via the macOS dialog, or: bagw approve <code>`);
  });
  return server;
}
