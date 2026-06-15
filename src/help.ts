const topics: Record<string, string> = {
  doctor: `ap doctor — readiness check (primary agent entrypoint)

  ap doctor [--json] [--bundle NAME] [--global] [--validate]

  Checks bundle readiness. Repo ap.toml first, then global fallback.
  --validate also lints manifests (inline secrets in git, bundle refs).

  Examples:
    ap doctor
    ap doctor --bundle namecheap --json
    ap doctor --validate`,

  edit: `ap edit — open manifests or secrets in $EDITOR

  ap edit <secrets|manifest|toml> [--global]

  secrets   secret values (JSON)
  manifest  global bundles + public vars (TOML)
  toml      project ap.toml

  Examples:
    ap edit secrets --global
    ap edit toml`,

  run: `ap run — inject secrets and run a command

  ap run [--bundle NAME] -- <cmd...>

  Resolves bundle vars, merges env, spawns subprocess.
  Use sh -c when the command needs shell env expansion ($VAR in args).

  Examples:
    ap run --bundle cloudflare -- sh -c \\
      'curl -sS -H "X-Auth-Email: $CF_GLOBAL_EMAIL" -H "X-Auth-Key: $CF_GLOBAL_API_KEY" https://api.cloudflare.com/client/v4/user'`,

  set: `ap set — store or remove a secret

  ap set KEY [--global]              stdin → vault
  ap set KEY --from-env [--global]   copy from process.env
  ap set KEY --unset [--global]      remove from vault

  Examples:
    echo "$KEY" | ap set NC_API_KEY --global
    ap set NC_API_KEY --from-env --global`,

  init: `ap init — scaffold project or global manifest

  ap init [--global] [BUNDLE...]

  Project: creates ap.toml + .ap/ (once).
  Global: creates or merges catalog bundles into ~/.config/ap/manifest.toml.

  Examples:
    ap init --global cloudflare namecheap
    ap init`,

  skill: `ap skill — Cursor agent skill

  ap skill install [--project]

  --project   install to .cursor/skills/ap/ in current repo
  (default)   install to ~/.cursor/skills/ap/ (all projects)`,

  catalog: `ap catalog list — available bundle templates

  ap catalog list [--json]

  Templates copied into ~/.config/ap/manifest.toml via ap init --global.`,
};

function mainHelp(): string {
  return `ap — agent-portable secrets

Usage:
  ap help [topic]                  Per-command help

  ap init [--global] [BUNDLE...]   Scaffold project or global manifest
  ap catalog list [--json]         Available catalog bundles
  ap set KEY [--global] [--from-env] [--unset]
  ap doctor [--json] [--bundle NAME] [--global] [--validate]
  ap run [--bundle NAME] -- <cmd...>
  ap edit <secrets|manifest|toml> [--global]
  ap skill install [--project]

Topics: ${Object.keys(topics).join(", ")}
  ap help doctor`;
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
