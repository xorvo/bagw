# bagw — Browser Agent Gateway

A tiny local service that lets browser extensions (and other local apps) run your
**already-installed AI coding agents** — Claude Code today, others later — using
**your existing config**, without ever handling your credentials.

Browsers can't launch a CLI, read `~/.aws`, run an SSO/credential-refresh command,
or talk to a local agent. `bagw` is the small, audited bridge that can. You install
it once; any extension can then ask it to run an agent — but only after **you
explicitly approve that extension**.

```
extension ──POST /invoke (per-client token)──▶ bagw ──spawns──▶ claude / codex (your config) ──▶ Bedrock / Anthropic / …
                         ▲                             in a temp dir, or a
              one-time approval dialog                 cwd you allowed
```

## Why

If your agent auth is profile/SSO-based (e.g. AWS Bedrock via `AWS_PROFILE` +
`CLAUDE_CODE_USE_BEDROCK=1` + an `awsAuthRefresh` command), there's no key to paste
into an extension. `bagw` runs your `claude` CLI, which applies your settings and
refreshes credentials automatically — so the extension needs **zero** credential
config.

## Install

### Homebrew (macOS)
```bash
brew install xorvo/tap/bagw
brew services start bagw          # run at login
```

### npm
```bash
npm install -g bagw
bagw install                      # macOS: install as a login service (launchd)
# or just run it in a terminal:
bagw start
```

Requires Node 18+ and at least one supported agent installed (e.g. the `claude`
CLI, working: `claude -p "hi"` should respond).

## Connect an extension (pairing)

`bagw` grants **no** access by default. When an extension first connects:

1. It calls `POST /pair` with its name.
2. `bagw` pops a **native approval dialog** — *"Allow ‹name› to use Claude Code via
   bagw?"* — on the machine running it. (No GUI? Approve from a terminal:
   `bagw approve <code>`.)
3. Only after you approve does the extension receive its own token.

Manage access anytime:

```bash
bagw clients              # who's approved + usage
bagw clients --pending    # pending requests
bagw approve <code>       # approve from the terminal
bagw revoke "<name>"      # cut a client off
bagw status               # is it running? how many clients?
```

## Security

- **127.0.0.1 only** — never bound to the network.
- **No web-page access** — only `chrome-extension://` origins get CORS, and
  authenticated calls require a Bearer token (a non-simple header), so a random
  website can neither read responses nor make authenticated calls.
- **Explicit per-client approval** — every client must be approved by you once;
  each gets its own token (stored only as a SHA-256 hash). All use is logged
  (`bagw.log` in the state directory) and revocable; there's a per-client rate limit.
- **Locked-down execution (blast-radius containment)** — agents run
  **completion-only**: no tools, single turn, and a temp working directory. Even an
  approved-then-misused client can only generate text and spend tokens — it
  **cannot** make the agent run shell commands, edit files, or touch your repos.
- **Working directories are opt-in** — a client may ask to run in a directory via
  `cwd`, but only inside the `cwdRoots` you configure; with none set (the default)
  any such request is refused. Both the request and your roots are resolved with
  `realpath` before comparison, so `..` and symlinks can't leave an allowed root.
  Granting a root does widen blast radius: an agent with tools can read files there.
- **Honest limit** — software already running as your user can read your files and
  could run `claude` itself; no local daemon can defend against that. `bagw` blocks
  *browser/web* and *unapproved* callers and contains blast radius.

## HTTP API (for client authors)

| Method | Path | Auth | Body / result |
|---|---|---|---|
| `GET` | `/health` | none | `{ ok, service, version, agents }` |
| `POST` | `/pair` | none | `{ name, agent? }` → `{ pairingId, code, approval, message }` |
| `GET` | `/pair/:pairingId` | none | `{ status: "pending"\|"approved"\|"denied"\|"unknown", token? }` (token returned once) |
| `POST` | `/invoke` | `Authorization: Bearer <token>` | `{ agent?, system, user, model?, cwd? }` → `{ ok, text, agent }` |

Pairing flow for a client: `POST /pair` → show the user the approval message →
poll `GET /pair/:pairingId` until `status === "approved"` → store the returned
`token` → call `/invoke` with it.

`cwd` is an absolute path to run the agent in. Omit it and the agent runs in a temp
directory. A path outside `cwdRoots` (or a missing one) comes back `400` with a
message you can show the user — it is not a server error.

## Where things live

| What | Path | Override |
|---|---|---|
| Config | `~/.config/bagw/config.json` | `XDG_CONFIG_HOME` |
| Client tokens + log | `~/.local/state/bagw/` | `XDG_STATE_HOME` |

Config is separate from state on purpose: one is worth backing up, the other is
per-machine secrets. `BAGW_DIR` puts both in a single directory instead.
`bagw doctor` prints the resolved paths.

Upgrading from 0.3.x or earlier, which used `~/.bagw`? Move the files once — bagw
warns on startup until you do, and pairings survive because `clients.json` moves
with them:

```bash
brew services stop bagw
mkdir -p ~/.config/bagw ~/.local/state/bagw
mv ~/.bagw/config.json ~/.config/bagw/
mv ~/.bagw/clients.json ~/.bagw/bagw.log ~/.local/state/bagw/
rmdir ~/.bagw && brew services start bagw
```

## Adding other agents

Agents are adapters defined in `config.json`:

```json
{
  "defaultAgent": "claude",
  "cwdRoots": ["~/projects"],
  "agents": {
    "claude": { "type": "claude-code", "bin": "claude" },
    "codex":  { "type": "command", "command": ["codex", "exec", "--skip-git-repo-check", "-m", "{model}"] },
    "mycli":  { "type": "command", "command": ["mycli", "--quiet", "--model", "{model}"] }
  }
}
```

- `claude-code` — runs Claude Code locked down (`-p --tools "" --max-turns 1
  --setting-sources user --system-prompt …`).
- `command` — any CLI that reads a prompt on stdin and prints text on stdout;
  `{model}` is substituted, `resultJsonPath` optionally extracts a field. A blank
  model drops the placeholder *and* the flag in front of it, so `-m {model}` won't
  leave a dangling `-m`.
- `cwdRoots` — directories clients may request via `cwd` (`~` is expanded). Empty
  or absent means no client can pick a working directory.

Use an absolute path for `bin`/`command[0]` if the CLI lives somewhere launchd
can't see (a version-manager shim, say). `bagw doctor` reports what resolves.

Callers pick an agent via the `agent` field on `/invoke` (defaults to `defaultAgent`).

## License

MIT — see [LICENSE](LICENSE).
