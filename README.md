# ap

Agent-portable local secrets. Declare **bundles** of credentials in committed manifests, store global secret values inline in TOML, and keep project secrets in `.ap/secrets.json`. Agents check readiness with `ap show <bundle> --check` before calling external APIs.

## Install

Requires **Node 18+**.

```bash
npm install -g @mergd/ap
```

From source:

```bash
git clone https://github.com/mergd/ap.git
cd ap
npm install
npm run build
npm link   # or: ln -sf "$(pwd)/bin/ap" ~/.local/bin/ap
```

## Quick start

Agents: run `ap guide` first (YAML contract for show → run → set).

```bash
# Optional: seed catalog var stubs into the global manifest
ap init -g                      # all catalog vars → ~/.config/ap/manifest.toml
# ap init -g cloudflare         # or pick a catalog bundle's vars

# Per repo (catalog owns bundle identity — no need to copy [bundle.*] globally)
ap init                         # ap.toml + .ap/ + project agent skill
# edit ap.toml → bundles = ["namecheap", "cloudflare"]
eval "$(op signin)"
ap setup                        # SOPS + 1Password — safe to commit .ap/secrets.json

# Set secrets (global by default → value= in manifest.toml)
echo "$NC_API_KEY" | ap set NC_API_KEY
echo "$KEY" | ap set CF_GLOBAL_API_KEY

# Project vault (.ap/secrets.json)
echo "$TOKEN" | ap set DEPLOY_TOKEN --project

# Inspect secrets and check readiness
ap show --check
ap show cloudflare --check

# Run commands with secrets injected
ap run cloudflare -- curl ...
```

Install the agent skill (Cursor, Claude Code, Codex):

```bash
ap skill install              # ~/.agents/skills/ap/ (+ symlinks for claude/cursor)
ap skill install --project    # same paths under current repo
```

`npm install -g @mergd/ap` runs `ap skill install` via postinstall (global). `ap init` installs the skill into the repo.

## How it works

**Bundles** group related env vars for a capability (e.g. `namecheap` → `NC_API_USER`, `NC_API_KEY`, `NC_CLIENT_IP`). Bundle identity (keys, ask/docs/prompt) lives in the built-in catalog; the global manifest only stores var stubs and values.

| File | Purpose |
|------|---------|
| `~/.config/ap/manifest.toml` | Global public vars **and secret values** (`value =`) |
| `ap.toml` | Which bundles this repo uses; project var declarations; `[encryption]` for 1Password age key |
| `.ap/secrets.json` | Project vault — all project-scoped secrets (SOPS after `ap setup`) |
| `.sops.yaml` | SOPS encryption rules (committed after `ap setup`) |

There is **no** global `secrets.json`. Project secrets always live in `.ap/secrets.json`:

```toml
# ap.toml
version = 1
scope = "project"

[var.DEPLOY_TOKEN]
visibility = "secret"
ask = "Deploy token for this repo"
```

```bash
echo "$TOKEN" | ap set DEPLOY_TOKEN --project
```

Project secrets use **SOPS + age** with the private key in **1Password** (same pattern as [lockbox](https://github.com/mergd/lockbox)). Run `ap setup` once per repo; teammates need `op` access to decrypt.

Public bundle values surface immediately in `ap show`. Secrets are never shown — only status and `set_with` commands.

```bash
ap guide              # agent contract
ap catalog            # built-in templates
ap help               # full command reference
```

## Commands

```
ap -V, --version                 Print version and update status
ap guide [--human]               Agent contract (primary entrypoint for agents)
ap show [BUNDLE] [-g] [--check] [--validate]
ap catalog
ap set KEY [-g|--project] [--from-env]
ap unset KEY [-g|--project]
ap run [BUNDLE] -- <cmd...>
ap init [-g|--global] [BUNDLE...]
ap setup
ap edit <secrets|global|project> [--ui] [--port N] [--no-open]
ap skill install [--project]
```

`-g` is short for `--global`. `ap set` defaults to writing `value` in the global manifest; use `--project` for the repo vault (`.ap/secrets.json`).

`ap edit --ui` opens a local Bootstrap-era page on `127.0.0.1` to edit project `ap.toml` (or `-g` / `global` for `manifest.toml`, including global secret values).

Output is human-readable in a terminal and YAML when piped. Catalog bundles: `cloudflare`, `namecheap`, `openrouter`.

`ap` checks npm for updates at most once per day and prints upgrade notices to stderr. Set `AP_NO_UPDATE_CHECK=1` to disable the check.

## Development

```bash
npm install
npm run build
npm test
npm run check
npm run dev -- show
```

## License

MIT
