const topics: Record<string, string> = {
  guide: `ap guide — agent contract (primary entrypoint)

  ap guide [--human]

  YAML by default. Succinct workflow, rules, paths, and command references.

  Examples:
    ap guide
    ap guide --human`,

  show: `ap show — inspect and check secrets

  ap show [BUNDLE] [--global] [--check] [--validate] [--human]

  Shows bundle status plus unbundled secrets. Secret values are never shown.
  --check exits nonzero when the selected secrets are not ready.
  --validate also checks manifests and project encryption.

  Examples:
    ap show
    ap show cloudflare --check
    ap show --global --validate`,

  edit: `ap edit — open manifests or secrets in $EDITOR

  ap edit <secrets|manifest|toml> [--global]

  secrets   secret values (JSON); falls back to global if no ap.toml
  manifest  global bundles + public vars (TOML)
  toml      project ap.toml

  Examples:
    ap edit secrets --global
    ap edit toml`,

  run: `ap run — inject secrets and run a command

  ap run [BUNDLE] -- <cmd...>

  Resolves bundle vars, merges env, spawns subprocess.
  Use sh -c when the command needs shell env expansion ($VAR in args).

  Examples:
    ap run cloudflare -- sh -c \\
      'curl -sS -H "X-Auth-Email: $CF_GLOBAL_EMAIL" -H "X-Auth-Key: $CF_GLOBAL_API_KEY" https://api.cloudflare.com/client/v4/user'`,

  set: `ap set — store a secret

  ap set KEY [--global]              stdin → vault
  ap set KEY --from-env [--global]   copy from process.env

  Examples:
    echo "$KEY" | ap set NC_API_KEY --global
    ap set NC_API_KEY --from-env --global`,

  unset: `ap unset — remove a secret

  ap unset KEY [--global]

  Examples:
    ap unset NC_API_KEY --global`,

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

  ap init [--global] [BUNDLE...]

  Project: creates ap.toml + .ap/ (once).
  Global: creates or merges catalog bundles into ~/.config/ap/manifest.toml.
  After project init, run ap setup to encrypt secrets for git.

  Examples:
    ap init --global cloudflare namecheap
    ap init
    ap setup`,

  skill: `ap skill — agent skill (Cursor, Claude Code, Codex)

  ap skill install [--project]

  Generates SKILL.md from ap guide (not a static copy).
  Installs to .agents/skills/ap/, .claude/skills/ap/, and .cursor/skills/ap/.
  --project   install under current repo
  (default)   install under home directory (all projects)`,

};

function mainHelp(): string {
  return `ap — agent-portable secrets

Usage:
  ap help [topic]                  Per-command help

  ap guide [--human]               Agent contract
  ap init [--global] [BUNDLE...]   Scaffold project or global manifest
  ap setup                         Encrypt project secrets (SOPS + 1Password)
  ap show [BUNDLE] [--global] [--check] [--validate]
  ap set KEY [--global] [--from-env]
  ap unset KEY [--global]
  ap run [BUNDLE] -- <cmd...>
  ap edit <secrets|manifest|toml> [--global]
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
