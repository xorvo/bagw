# bagw — Browser Agent Gateway

A tiny local service that lets browser extensions (and other local apps) run your
**already-installed AI coding agents** — Claude Code today, others later — using
**your existing config**, without ever handling your credentials.

Browsers can't launch a CLI, read `~/.aws`, run an SSO/credential-refresh command,
or talk to a local agent. `bagw` is the small, audited bridge that can. You install
it once; any extension can then ask it to run an agent — but only after **you
explicitly approve that extension**.

```
extension ──POST /invoke (per-client token)──▶ bagw ──spawns──▶ claude (your config) ──▶ Bedrock / Anthropic / …
                         ▲
              one-time approval dialog
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
  (`~/.bagw/bagw.log`) and revocable; there's a per-client rate limit.
- **Locked-down execution (blast-radius containment)** — agents run
  **completion-only**: no tools, single turn, neutral working directory. Even an
  approved-then-misused client can only generate text and spend tokens — it
  **cannot** make the agent run shell commands, edit files, or touch your repos.
- **Honest limit** — software already running as your user can read your files and
  could run `claude` itself; no local daemon can defend against that. `bagw` blocks
  *browser/web* and *unapproved* callers and contains blast radius.

## HTTP API (for client authors)

| Method | Path | Auth | Body / result |
|---|---|---|---|
| `GET` | `/health` | none | `{ ok, service, version, agents }` |
| `POST` | `/pair` | none | `{ name, agent? }` → `{ pairingId, code, approval, message }` |
| `GET` | `/pair/:pairingId` | none | `{ status: "pending"\|"approved"\|"denied"\|"unknown", token? }` (token returned once) |
| `POST` | `/invoke` | `Authorization: Bearer <token>` | `{ agent?, system, user, model? }` → `{ ok, text, agent }` |

Pairing flow for a client: `POST /pair` → show the user the approval message →
poll `GET /pair/:pairingId` until `status === "approved"` → store the returned
`token` → call `/invoke` with it.

## Adding other agents

Agents are adapters defined in `~/.bagw/config.json`:

```json
{
  "defaultAgent": "claude",
  "agents": {
    "claude": { "type": "claude-code", "bin": "claude" },
    "mycli":  { "type": "command", "command": ["mycli", "--quiet", "--model", "{model}"] }
  }
}
```

- `claude-code` — runs Claude Code locked down (`-p --tools "" --max-turns 1
  --setting-sources user --system-prompt …`).
- `command` — any CLI that reads a prompt on stdin and prints text on stdout;
  `{model}` is substituted, `resultJsonPath` optionally extracts a field.

Callers pick an agent via the `agent` field on `/invoke` (defaults to `defaultAgent`).

## License

MIT — see [LICENSE](LICENSE).
