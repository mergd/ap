---
name: ap
description: >-
  Agent-portable local secrets. Use before external API calls, deployments, or
  any task needing third-party credentials. Never ask the user to paste secrets
  in chat.
---

# ap secrets workflow

## Before any external API or deploy task

1. Run `ap doctor --json` (or `ap doctor --bundle namecheap --json` for one capability).
2. Check `bundles` in the output — each bundle groups related secrets:
   - `surfaced` — public/derived values available immediately (use these, don't ask)
   - `missing` — secrets the user must set via `set_with`
   - `secrets_set` — configured secrets (values never shown)
3. If a bundle is not `ready`, show the user `ask` + `set_with` from `missing` entries.
4. Never request secret values in chat.

```bash
echo "$KEY" | ap set NC_API_KEY --global
ap doctor --bundle namecheap --json
ap run -- curl ...
```

## Bundles vs Cursor skills

**Bundles** in `ap.toml` are named groups of env vars for HTTP/API workflows — not Cursor skills.

- `namecheap`, `cloudflare` — REST API tokens injected via `ap run --`
- **Not** for CLI login flows (`railway login`, `vercel login`) — those use interactive auth, not `ap` vault

A Cursor skill references bundles in frontmatter:

```yaml
requires:
  bundles: [namecheap]
```

That tells the agent to run `ap doctor --bundle namecheap --json` before calling the Namecheap API.

## Where files live

```bash
ap paths
```

| File | Purpose |
|------|---------|
| `~/.config/ap/manifest.toml` | Bundles, public vars, ask text |
| `~/.config/ap/secrets.json` | **Secret values** (global) |
| `ap.toml` | Which bundles this repo uses |
| `.ap/secrets.json` | Project-only secret values |

```bash
ap edit secrets --global   # edit secret values
ap edit manifest --global  # edit bundles + public vars
ap edit ap                 # edit project ap.toml
ap skill install           # Cursor skill → ~/.cursor/skills/ap/
```
