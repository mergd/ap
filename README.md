# ap

Agent-portable local secrets. Declare **bundles** of credentials in committed manifests, store secret values in gitignored vaults, and let agents check readiness with `ap show <bundle> --check` before calling external APIs.

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
# One-time machine setup
ap init --global                    # all catalog bundles → ~/.config/ap/manifest.toml
# ap init --global cloudflare       # or pick bundles
# ap init --global openrouter       # merge OpenRouter bundle into existing manifest

# Per repo (optional — global fallback works without ap.toml)
ap init
eval "$(op signin)"
ap setup                            # SOPS + 1Password — safe to commit .ap/secrets.json
# edit ap.toml → bundles = ["namecheap", "cloudflare"]

# Set secrets (never paste in chat)
echo "$NC_API_KEY" | ap set NC_API_KEY --global
echo "$KEY" | ap set CF_GLOBAL_API_KEY --global

# Inspect secrets and check readiness
ap show --check

# Run commands with secrets injected
ap run -- curl ...
```

Install the agent skill (Cursor, Claude Code, Codex):

```bash
ap skill install              # ~/.agents/skills/ap/, ~/.claude/skills/ap/, ~/.cursor/skills/ap/
ap skill install --project    # same paths under current repo
```

## How it works

**Bundles** group related env vars for a capability (e.g. `namecheap` → `NC_API_USER`, `NC_API_KEY`, `NC_CLIENT_IP`).

| File | Purpose |
|------|---------|
| `~/.config/ap/manifest.toml` | Global bundle definitions, public vars, ask text |
| `~/.config/ap/secrets.json` | Global secret values |
| `ap.toml` | Which bundles this repo uses (optional) |
| `.ap/secrets.json` | Project secrets — SOPS-encrypted after `ap setup` (safe to commit) |
| `.sops.yaml` | SOPS encryption rules (committed after `ap setup`) |
| `.ap/config.toml` | 1Password vault/item for age key (committed) |

Project secrets use **SOPS + age** with the private key in **1Password** (same pattern as [lockbox](https://github.com/mergd/lockbox)). Run `ap setup` once per repo; teammates need `op` access to decrypt.

Public bundle values surface immediately in `ap show`. Secrets are never shown — only status and `set_with` commands.

```bash
ap guide              # agent contract
ap help               # full command reference
```

## Commands

```
ap guide [--human]               Agent contract (primary entrypoint for agents)
ap show [BUNDLE] [--global] [--check] [--validate]
ap set KEY [--global] [--from-env]
ap unset KEY [--global]
ap run [BUNDLE] -- <cmd...>
ap init [--global] [BUNDLE...]
ap setup
ap edit <secrets|manifest|toml> [--global]
ap skill install [--project]
```

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
