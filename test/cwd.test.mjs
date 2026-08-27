// Working-directory allowlist checks. Run: npm test
//
// resolveCwd decides which files a client can expose to the agent, so the cases
// that matter here are the escapes: traversal, symlinks, and root-prefix traps.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";

import { resolveCwd, buildCommandArgs } from "../src/agents.mjs";

const base = realpathSync(mkdtempSync(join(tmpdir(), "bagw-cwd-")));
const root = join(base, "projects");
const inside = join(root, "repo");
const outside = join(base, "secrets");
mkdirSync(inside, { recursive: true });
mkdirSync(outside, { recursive: true });

const cfg = { cwdRoots: [root] };
const noRoots = { cwdRoots: [] };

// No cwd requested → the locked-down default, whatever the config says.
assert.equal(resolveCwd(cfg, ""), tmpdir());
assert.equal(resolveCwd(noRoots, undefined), tmpdir());

// Opt-in: without cwdRoots, asking for any directory is refused.
assert.throws(() => resolveCwd(noRoots, inside), /no "cwdRoots" are configured/);
assert.equal(
  (() => {
    try {
      resolveCwd(noRoots, inside);
    } catch (e) {
      return e.status;
    }
  })(),
  400,
  "cwd rejections must be client errors, not 500s"
);

// Allowed paths: the root itself and anything under it, returned realpath'd.
assert.equal(resolveCwd(cfg, root), root);
assert.equal(resolveCwd(cfg, inside), inside);

// Rejections.
assert.throws(() => resolveCwd(cfg, "projects/repo"), /absolute path/);
assert.throws(() => resolveCwd(cfg, join(root, "nope")), /doesn't exist/);
assert.throws(() => resolveCwd(cfg, outside), /outside the allowed cwdRoots/);

// Traversal: a path that only *looks* like it's under the root.
assert.throws(() => resolveCwd(cfg, join(root, "..", "secrets")), /outside the allowed/);

// Symlink inside the root pointing out of it.
const escape = join(root, "escape");
symlinkSync(outside, escape);
assert.throws(() => resolveCwd(cfg, escape), /outside the allowed/);

// Prefix trap: a sibling whose name starts with the root's name.
const sibling = `${root}-evil`;
mkdirSync(sibling);
assert.throws(() => resolveCwd(cfg, sibling), /outside the allowed/);

// A file is not a working directory.
const file = join(inside, "notes.txt");
writeFileSync(file, "hi");
assert.throws(() => resolveCwd(cfg, file), /not a directory/);

// A configured root that doesn't exist allows nothing.
assert.throws(
  () => resolveCwd({ cwdRoots: [join(base, "ghost")] }, inside),
  /outside the allowed/
);

// "~" in a root is expanded.
assert.equal(resolveCwd({ cwdRoots: ["~"] }, homedir()), realpathSync(homedir()));

// {model} substitution: a blank model must take its flag with it, or the CLI
// sees a flag with no value and exits non-zero.
const cmd = ["exec", "--skip-git-repo-check", "-m", "{model}"];
assert.deepEqual(buildCommandArgs(cmd, "gpt-5.5-codex"), [
  "exec",
  "--skip-git-repo-check",
  "-m",
  "gpt-5.5-codex",
]);
assert.deepEqual(buildCommandArgs(cmd, ""), ["exec", "--skip-git-repo-check"]);
// A bare placeholder with no flag in front just disappears.
assert.deepEqual(buildCommandArgs(["run", "{model}", "--json"], ""), ["run", "--json"]);

console.log("cwd allowlist + arg building: all checks passed");
