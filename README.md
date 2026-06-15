# ap

Agent-portable local secrets. Declare **bundles** of credentials in committed manifests, store secret values in gitignored vaults, and let agents check readiness with `ap doctor --json` before calling external APIs.

## Install

```bash
git clone https://github.com/mergd/ap.git
cd ap
bun install
ln -sf "$(pwd)/bin/ap" ~/.local/bin/ap   # or add bin/ to PATH
```

Requires [Bun](https://bun.sh).

## Quick start

```bash
# One-time machine setup
ap global init
cp global-manifest.example.toml ~/.config/ap/manifest.toml

# Per repo
ap init
# edit ap.toml → bundles = ["namecheap", "cloudflare"]

# Set secrets (never paste in chat)
echo "$NC_API_KEY" | ap set NC_API_KEY --global
echo "$CLOUDFLARE_API_TOKEN" | ap set CLOUDFLARE_API_TOKEN --global

# Check readiness
ap doctor

# Run commands with secrets injected
ap run -- curl ...
```

Install the Cursor agent skill:

```bash
ap skill install              # ~/.cursor/skills/ap/ (all projects)
ap skill install --project    # .cursor/skills/ap/ (this repo)
```

## How it works

**Bundles** group related env vars for a capability (e.g. `namecheap` → `NC_API_USER`, `NC_API_KEY`, `NC_CLIENT_IP`).

| File | Purpose |
|------|---------|
| `~/.config/ap/manifest.toml` | Global bundle definitions, public vars, ask text |
| `~/.config/ap/secrets.json` | Global secret values |
| `ap.toml` | Which bundles this repo uses |
| `.ap/secrets.json` | Project-only secrets (gitignored) |

Public and derived values surface immediately in `ap doctor`. Secrets are never shown — only `set_with` commands.

```bash
ap paths    # show all file locations
ap help     # full command reference
```

## Commands

```
ap doctor [--json] [--bundle NAME]   readiness check (agent entrypoint)
ap set KEY [--global]                store secret via stdin
ap adopt KEY [--global]              copy from process.env
ap edit [secrets|manifest|ap]        open in $EDITOR
ap run -- <cmd...>                   resolve secrets, run command
ap skill install [--project]         install Cursor skill
ap global init                       scaffold ~/.config/ap/
```

## Development

```bash
bun test
bun run check
bun run dev -- doctor --json
```

## License

MIT
