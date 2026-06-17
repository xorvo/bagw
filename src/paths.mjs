import { homedir } from "node:os";
import { join } from "node:path";

// All bagw state lives here. Override with BAGW_DIR (used by tests).
export const DIR = process.env.BAGW_DIR || join(homedir(), ".bagw");
export const CLIENTS_FILE = join(DIR, "clients.json");
export const CONFIG_FILE = join(DIR, "config.json");
export const LOG_FILE = join(DIR, "bagw.log");

export const SERVICE_LABEL = "dev.bagw";
