// Native approval prompt. On macOS we pop a real dialog (works even when bagw
// runs as a background LaunchAgent, since it shares the user's GUI session).
// Elsewhere — or if the dialog can't be shown — the request stays pending and
// the user approves it from a terminal with `bagw approve <code>`.

import { spawn } from "node:child_process";

export function canShowDialog() {
  return process.platform === "darwin" && process.env.BAGW_NO_DIALOG !== "1";
}

export function showApprovalDialog({ name, agent, code }, onAllow, onDeny) {
  // BAGW_NO_DIALOG forces terminal approval (headless hosts, automated tests).
  if (process.platform !== "darwin" || process.env.BAGW_NO_DIALOG === "1") {
    onDeny("no-gui");
    return false;
  }
  const safeName = String(name).replace(/["\\]/g, "");
  const message =
    `Allow “${safeName}” to use ${agent} via bagw?  (request ${code})\n\n` +
    `This lets it generate text using your account. Approve only if you just ` +
    `connected this app.`;
  const script =
    `display dialog ${JSON.stringify(message)} ` +
    `with title "bagw — access request" ` +
    `buttons {"Deny", "Allow"} default button "Deny" cancel button "Deny" ` +
    `with icon caution`;

  let out = "";
  let child;
  try {
    child = spawn("osascript", ["-e", script]);
  } catch {
    onDeny("spawn-failed");
    return false;
  }
  child.stdout.on("data", (d) => (out += d));
  child.on("error", () => onDeny("spawn-error"));
  child.on("close", (exitCode) => {
    if (exitCode === 0 && /Allow/.test(out)) onAllow();
    else onDeny("denied");
  });
  return true;
}
