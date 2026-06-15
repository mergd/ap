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
   - `surfaced` — public values available immediately (use these, don't ask)
   - `missing` — secrets the user must set via `set_with`
   - `secrets_set` — configured secrets (values never shown)
   - `prompt` — how to use the bundle when ready (auth shape, which vars)
3. If a bundle is not `ready`, show the user `ask` + `set_with` from `missing` entries.
4. Never request secret values in chat.

```bash
echo "$KEY" | ap set NC_API_KEY --global
ap doctor --bundle cloudflare --json
ap run --bundle cloudflare -- sh -c 'curl -H "X-Auth-Email: $CF_GLOBAL_EMAIL" ...'
```

## Bundles vs Cursor skills

**Bundles** are named groups of env vars for HTTP/API workflows — not Cursor skills.

Built-in bundles (`cloudflare`, `namecheap`) are catalog templates. `ap init --global` copies them into `~/.config/ap/manifest.toml` — that's the source of truth at runtime.

```bash
ap catalog list
ap init --global cloudflare namecheap   # create or merge into global manifest
```

Project `ap.toml` opts in: `bundles = ["cloudflare"]`. Without it, global bundles are used automatically.

A Cursor skill references bundles in frontmatter:

```yaml
requires:
  bundles: [namecheap]
```

That tells the agent to run `ap doctor --bundle namecheap --json` before calling the Namecheap API.

## Where files live

| File | Purpose |
|------|---------|
| `~/.config/ap/manifest.toml` | Bundles, public vars, ask text |
| `~/.config/ap/secrets.json` | **Secret values** (global) |
| `ap.toml` | Which bundles this repo uses (optional) |
| `.ap/secrets.json` | Project-only secret values |

```bash
ap edit secrets --global   # edit secret values
ap edit manifest           # edit bundles + public vars
ap edit toml               # edit project ap.toml
ap skill install           # Cursor skill → ~/.cursor/skills/ap/
```
