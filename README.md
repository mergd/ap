# ap

Agent-portable local secrets. Declare **bundles** of credentials in committed manifests, store global secret values inline in TOML, and opt project secrets into `.ap/secrets.json` explicitly. Agents check readiness with `ap show <bundle> --check` before calling external APIs.

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
# Optional: copy catalog templates into the global manifest
ap init -g                      # all catalog bundles → ~/.config/ap/manifest.toml
# ap init -g cloudflare         # or pick bundles

# Per repo (optional — catalog fallback works without copying bundles globally)
ap init
# edit ap.toml → bundles = ["namecheap", "cloudflare"]
eval "$(op signin)"
ap setup                        # SOPS + 1Password — safe to commit .ap/secrets.json

# Set secrets (global by default → value= in manifest.toml)
echo "$NC_API_KEY" | ap set NC_API_KEY
echo "$KEY" | ap set CF_GLOBAL_API_KEY

# Project vault (declares storage = "secrets.json" automatically)
echo "$TOKEN" | ap set DEPLOY_TOKEN --project

# Inspect secrets and check readiness
ap show --check
ap show cloudflare --check

# Run commands with secrets injected
ap run cloudflare -- curl ...
```

If you still have a legacy `~/.config/ap/secrets.json`, run `ap migrate`.

Install the agent skill (Cursor, Claude Code, Codex):

```bash
ap skill install              # ~/.agents/skills/ap/ (+ symlinks for claude/cursor)
ap skill install --project    # same paths under current repo
```

## How it works

**Bundles** group related env vars for a capability (e.g. `namecheap` → `NC_API_USER`, `NC_API_KEY`, `NC_CLIENT_IP`). Built-in catalog templates resolve at runtime even if not copied into `~/.config/ap/manifest.toml`.

| File | Purpose |
|------|---------|
| `~/.config/ap/manifest.toml` | Global bundles, public vars, **and secret values** (`value =`) |
| `ap.toml` | Which bundles this repo uses; project vars; optional `storage = "secrets.json"` |
| `.ap/secrets.json` | Project vault — only when a var declares `storage = "secrets.json"` (SOPS after `ap setup`) |
| `.sops.yaml` | SOPS encryption rules (committed after `ap setup`) |
| `.ap/config.toml` | 1Password vault/item for age key (committed) |

There is **no** global `secrets.json`. Project vault use is never implied by scope — declare it:

```toml
# ap.toml
version = 1
scope = "project"

[var.DEPLOY_TOKEN]
visibility = "secret"
storage = "secrets.json"
ask = "Deploy token for this repo"
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
ap -V, --version                 Print version
ap guide [--human]               Agent contract (primary entrypoint for agents)
ap show [BUNDLE] [-g] [--check] [--validate]
ap catalog
ap set KEY [-g|--project] [--from-env]
ap unset KEY [-g|--project]
ap migrate                       Legacy secrets.json → TOML-first
ap run [BUNDLE] -- <cmd...>
ap init [-g|--global] [BUNDLE...]
ap setup
ap edit <secrets|global|project>
ap ui [-g|--global] [--port N] [--no-open]
ap skill install [--project]
```

`-g` is short for `--global`. `ap set` defaults to writing `value` in the global manifest; use `--project` for the repo vault (`storage = "secrets.json"`).

`ap ui` opens a local Bootstrap-era page on `127.0.0.1` to edit project `ap.toml` (or `-g` for `manifest.toml`, including global secret values).

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
