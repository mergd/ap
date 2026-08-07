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
# Optional: copy catalog templates into the global manifest
ap init -g                      # all catalog bundles → ~/.config/ap/manifest.toml
# ap init -g cloudflare         # or pick bundles

# Per repo (optional — catalog fallback works without copying bundles globally)
ap init
# edit ap.toml → bundles = ["namecheap", "cloudflare"]
eval "$(op signin)"
ap setup                        # SOPS + 1Password — safe to commit .ap/secrets.json

# Set secrets (global by default)
echo "$NC_API_KEY" | ap set NC_API_KEY
echo "$KEY" | ap set CF_GLOBAL_API_KEY

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

## How it works

**Bundles** group related env vars for a capability (e.g. `namecheap` → `NC_API_USER`, `NC_API_KEY`, `NC_CLIENT_IP`). Built-in catalog templates resolve at runtime even if not copied into `~/.config/ap/manifest.toml`.

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
ap catalog            # built-in templates
ap help               # full command reference
```

## Commands

```
ap guide [--human]               Agent contract (primary entrypoint for agents)
ap show [BUNDLE] [-g] [--check] [--validate]
ap catalog
ap set KEY [-g|--project] [--from-env]
ap unset KEY [-g|--project]
ap run [BUNDLE] -- <cmd...>
ap init [-g|--global] [BUNDLE...]
ap setup
ap edit <secrets|global|project> [-g]
ap skill install [--project]
```

`-g` is short for `--global`. `ap set` / `ap unset` default to the global vault; use `--project` for the repo vault.

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
