// Client + pairing store. Disk is the source of truth so the running daemon and
// one-off CLI commands (`bagw approve`, `bagw revoke`) stay in sync without IPC.
//
// Security model:
//   - A client gets NO access until the user explicitly approves a pairing.
//   - Each approved client has its own bearer token; we store only its SHA-256
//     hash, never the raw token.
//   - Tokens are compared in constant time.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DIR, CLIENTS_FILE } from "./paths.mjs";

function ensureDir() {
  mkdirSync(DIR, { recursive: true });
}

function read() {
  ensureDir();
  if (!existsSync(CLIENTS_FILE)) return { clients: [], pending: [] };
  try {
    const d = JSON.parse(readFileSync(CLIENTS_FILE, "utf8"));
    return { clients: d.clients || [], pending: d.pending || [] };
  } catch {
    return { clients: [], pending: [] };
  }
}

function write(data) {
  ensureDir();
  const tmp = `${CLIENTS_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, CLIENTS_FILE);
  try {
    chmodSync(CLIENTS_FILE, 0o600);
  } catch {}
}

export function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

function newId(prefix) {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

function newToken() {
  return randomBytes(32).toString("hex");
}

function newCode() {
  const hex = randomBytes(4).toString("hex").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

function sanitizeName(name) {
  return String(name || "Unknown client")
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, 80) || "Unknown client";
}

function prunePending(data, ttlMs) {
  const now = Date.now();
  data.pending = data.pending.filter(
    (p) => now - new Date(p.requestedAt).getTime() < ttlMs
  );
}

// ---- pairings --------------------------------------------------------------
export function createPending(name, ttlMs, nowIso) {
  const data = read();
  prunePending(data, ttlMs);
  const pairing = {
    pairingId: newId("pr"),
    name: sanitizeName(name),
    code: newCode(),
    status: "pending",
    requestedAt: nowIso,
  };
  data.pending.push(pairing);
  write(data);
  return pairing;
}

export function getPending(pairingId, ttlMs) {
  const data = read();
  prunePending(data, ttlMs);
  write(data);
  return data.pending.find((p) => p.pairingId === pairingId) || null;
}

export function listPending(ttlMs) {
  const data = read();
  prunePending(data, ttlMs);
  write(data);
  return data.pending;
}

// Approve a pending pairing -> creates a client + token. Returns { client, token }
// or null if not found. The raw token is stashed on the pending record so the
// client's next poll can retrieve it exactly once.
export function approve(match, nowIso) {
  const data = read();
  const p = data.pending.find(
    (x) =>
      x.status === "pending" &&
      (x.pairingId === match || x.code === String(match).toUpperCase())
  );
  if (!p) return null;
  const token = newToken();
  const client = {
    id: newId("cl"),
    name: p.name,
    tokenHash: sha256(token),
    createdAt: nowIso,
    lastUsedAt: null,
    calls: 0,
  };
  data.clients.push(client);
  p.status = "approved";
  p.clientId = client.id;
  p.token = token; // retrieved once by the polling client, then cleared
  write(data);
  return { client, token };
}

export function deny(match) {
  const data = read();
  const p = data.pending.find(
    (x) => x.pairingId === match || x.code === String(match).toUpperCase()
  );
  if (!p) return false;
  p.status = "denied";
  write(data);
  return true;
}

// Called by the polling client. Returns the token once, then clears it.
export function claimToken(pairingId) {
  const data = read();
  const p = data.pending.find((x) => x.pairingId === pairingId);
  if (!p) return { status: "unknown" };
  if (p.status === "approved" && p.token) {
    const token = p.token;
    data.pending = data.pending.filter((x) => x.pairingId !== pairingId);
    write(data);
    return { status: "approved", token };
  }
  return { status: p.status };
}

// ---- clients ---------------------------------------------------------------
export function listClients() {
  return read().clients;
}

export function revoke(nameOrId) {
  const data = read();
  const before = data.clients.length;
  const key = String(nameOrId);
  data.clients = data.clients.filter(
    (c) => c.id !== key && c.name !== key
  );
  write(data);
  return before - data.clients.length;
}

export function findClientByToken(token) {
  if (!token) return null;
  const hash = sha256(token);
  const data = read();
  const hb = Buffer.from(hash);
  return (
    data.clients.find((c) => {
      const cb = Buffer.from(c.tokenHash || "");
      return cb.length === hb.length && timingSafeEqual(cb, hb);
    }) || null
  );
}

export function recordUse(clientId, nowIso) {
  const data = read();
  const c = data.clients.find((x) => x.id === clientId);
  if (c) {
    c.lastUsedAt = nowIso;
    c.calls = (c.calls || 0) + 1;
    write(data);
  }
}
