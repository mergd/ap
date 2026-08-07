const topics: Record<string, string> = {
  guide: `ap guide — agent contract (primary entrypoint)

  ap guide [--human]

  YAML by default. Succinct workflow, rules, paths, and command references.

  Examples:
    ap guide
    ap guide --human`,

  show: `ap show — inspect and check secrets

  ap show [BUNDLE] [-g|--global] [--check] [--validate] [--human]

  Shows bundle status plus unbundled secrets. Secret values are never shown.
  Catalog bundles resolve even if not copied into the global manifest.
  --check exits nonzero when the selected secrets are not ready.
  --validate also checks manifests and project encryption.

  Examples:
    ap show
    ap show cloudflare --check
    ap show --global --validate`,

  catalog: `ap catalog — list built-in bundle templates

  ap catalog [--human]

  YAML by default. Templates used by ap init --global and as runtime fallback.

  Examples:
    ap catalog
    ap catalog --human`,

  edit: `ap edit — open manifests or secrets in $EDITOR

  ap edit <secrets|global|project> [-g|--global]

  secrets   secret values (JSON); falls back to global if no ap.toml
  global    ~/.config/ap/manifest.toml (alias: manifest)
  project   repo ap.toml (alias: toml)

  Examples:
    ap edit secrets
    ap edit global
    ap edit project`,

  run: `ap run — inject secrets and run a command

  ap run [BUNDLE] -- <cmd...>

  Resolves bundle vars, merges env, spawns subprocess.
  Unknown bundle names error (run: ap catalog).
  Use sh -c when the command needs shell env expansion ($VAR in args).

  Examples:
    ap run cloudflare -- sh -c \\
      'curl -sS -H "X-Auth-Email: $CF_GLOBAL_EMAIL" -H "X-Auth-Key: $CF_GLOBAL_API_KEY" https://api.cloudflare.com/client/v4/user'`,

  set: `ap set — store a secret (global by default)

  ap set KEY [--project]              stdin → vault
  ap set KEY --from-env [--project]   copy from process.env
  ap set KEY -g|--global              same as default (explicit)

  Examples:
    echo "$KEY" | ap set NC_API_KEY
    ap set NC_API_KEY --from-env
    echo "$TOKEN" | ap set DEPLOY_TOKEN --project`,

  unset: `ap unset — remove a secret (global by default)

  ap unset KEY [--project]

  Examples:
    ap unset NC_API_KEY
    ap unset DEPLOY_TOKEN --project`,

  setup: `ap setup — enable SOPS encryption via 1Password

  ap setup

  Syncs age key to 1Password, writes .sops.yaml, encrypts .ap/secrets.json.
  Commit .sops.yaml, .ap/config.toml, and encrypted secrets to share safely.

  Requires: op (1Password CLI), sops, age
  Run first: eval "$(op signin)"

  Examples:
    ap init
    ap setup
    git add .sops.yaml .ap/`,

  init: `ap init — scaffold project or global manifest

  ap init [-g|--global] [BUNDLE...]

  Project: creates ap.toml + .ap/ (once).
  Global: creates or merges catalog bundles into ~/.config/ap/manifest.toml.
  Catalog bundles also resolve at runtime without copying — init -g is
  optional when you only need readiness / ap run.
  After project init, run ap setup to encrypt secrets for git.

  Examples:
    ap init -g cloudflare namecheap
    ap init
    ap setup`,

  skill: `ap skill — agent skill (Cursor, Claude Code, Codex)

  ap skill install [--project]

  Writes a short agent skill (workflow + rules + commands).
  Installs to .agents/skills/ap/, .claude/skills/ap/, and .cursor/skills/ap/.
  --project   install under current repo
  (default)   install under home directory (all projects)`,

};

function mainHelp(): string {
  return `ap — agent-portable secrets

Usage:
  ap help [topic]                  Per-command help

  ap guide [--human]               Agent contract
  ap show [BUNDLE] [--check]       Readiness (YAML default)
  ap catalog                       Built-in bundle templates
  ap set KEY [--project] [--from-env]
  ap unset KEY [--project]
  ap run [BUNDLE] -- <cmd...>
  ap init [-g|--global] [BUNDLE...]
  ap setup                         Encrypt project secrets (SOPS + 1Password)
  ap edit <secrets|global|project>
  ap skill install [--project]

Topics: ${Object.keys(topics).join(", ")}
  ap help guide`;
}

export function printHelp(topic?: string): void {
  if (!topic) {
    console.log(mainHelp());
    return;
  }

  const text = topics[topic];
  if (!text) {
    console.error(`Unknown help topic: ${topic}`);
    console.error(`Topics: ${Object.keys(topics).join(", ")}`);
    process.exit(1);
  }

  console.log(text);
}

export function helpTopics(): string[] {
  return Object.keys(topics);
}
