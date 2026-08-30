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

  edit: `ap edit — open manifests or secrets

  ap edit <secrets|global|project> [-g|--global]
  ap edit [--ui] [global|project] [-g|--global] [--port N] [--no-open]

  secrets   project .ap/secrets.json (project-scoped secret values)
  global    ~/.config/ap/manifest.toml (alias: manifest) — includes secret values
  project   repo ap.toml (alias: toml)

  Default opens $EDITOR. --ui serves a local browser editor on 127.0.0.1
  (TOML only — not secrets). Default --ui target is project ap.toml.
  -g / --global   edit ~/.config/ap/manifest.toml
  --port N        listen port (default 4789)
  --no-open       print URL only (don't open browser)

  Project vault values: ap edit secrets / ap set KEY.

  Examples:
    ap edit secrets
    ap edit global
    ap edit project
    ap edit --ui
    ap edit --ui -g
    ap edit global --ui --port 8080 --no-open`,

  run: `ap run — inject secrets and run a command

  ap run [BUNDLE] -- <cmd...>

  Resolves bundle vars, merges env, spawns subprocess.
  Unknown bundle names error (run: ap catalog).
  Use sh -c when the command needs shell env expansion ($VAR in args).

  Examples:
    ap run cloudflare -- sh -c \\
      'curl -sS -H "X-Auth-Email: $CF_GLOBAL_EMAIL" -H "X-Auth-Key: $CF_GLOBAL_API_KEY" https://api.cloudflare.com/client/v4/user'`,

  set: `ap set — store a secret (project by default)

  ap set KEY                          stdin → .ap/secrets.json
  ap set KEY --project                same as default (backward-compatible explicit form)
  ap set KEY --from-env               copy from process.env into .ap/secrets.json
  ap set KEY -g|--global              stdin → value in ~/.config/ap/manifest.toml

  Examples:
    echo "$TOKEN" | ap set DEPLOY_TOKEN
    ap set DEPLOY_TOKEN --from-env
    echo "$KEY" | ap set NC_API_KEY --global`,

  load: `ap load env — store declared environment variables

  ap load env                       process environment → project secrets
  ap load env --global              process environment → global manifest

  Only variables declared in the selected manifest are loaded. Values are never
  printed. Missing variables fail before they are stored.

  Examples:
    ap load env
    ap load env --global`,

  unset: `ap unset — remove a secret (project by default)

  ap unset KEY [-g|--global|--project]

  Project (default): removes key from .ap/secrets.json.
  Global (--global): clears value in manifest.toml.

  Examples:
    ap unset DEPLOY_TOKEN
    ap unset NC_API_KEY --global`,

  setup: `ap setup — enable SOPS encryption via 1Password

  ap setup

  Syncs age key to 1Password, writes .sops.yaml, encrypts .ap/secrets.json.
  Commit .sops.yaml, ap.toml, and encrypted secrets to share safely.

  Requires: op (1Password CLI), sops, age
  Run first: eval "$(op signin)"

  Examples:
    ap init
    ap setup
    git add .sops.yaml ap.toml .ap/`,

  init: `ap init — scaffold project or global manifest

  ap init [-g|--global] [BUNDLE...]

  Project: creates ap.toml, .ap/, and installs the agent skill under the repo.
  Global: creates or merges catalog var stubs into ~/.config/ap/manifest.toml.
  Bundle identity stays in the catalog — init -g does not write [bundle.*].
  Catalog bundles also resolve at runtime from values alone.
  After project init, run ap setup to encrypt secrets for git.

  Examples:
    ap init -g cloudflare namecheap
    ap init
    ap setup`,

  hooks: `ap hooks — run a script after set/unset

  Bind events in ap.toml to an executable (paths relative to the project root):

    [hooks]
    after_set = ".ap/hooks/sync"
    after_unset = ".ap/hooks/sync"
    after_run = ".ap/hooks/sync"

  If a hook is unbound, ap runs .ap/hooks/<event> when that file exists.
  The script does the work (e.g. git pull --rebase && git push). chmod +x it.

  after_set / after_unset fail closed. before_show warns and continues.
  after_run is spawned in the background and never fails ap run — handle errors in the script.
  Set AP_NO_HOOKS=1 to disable. Use after_set = "none" to ignore even .ap/hooks/after_set.

  Examples:
    echo "$TOKEN" | ap set DEPLOY_TOKEN`,

  skill: `ap skill — agent skill (Cursor, Claude Code, Codex)

  ap skill install [--project]

  Writes a short agent skill (workflow + rules + commands).
  Installs to .agents/skills/ap/, .claude/skills/ap/, and .cursor/skills/ap/.
  --project   install under current repo
  (default)   install under home directory (all projects)
  Also runs on ap init (project). First CLI runs tip \`ap skill install\` if the global skill is missing.`,

};

function mainHelp(): string {
  return `ap — agent-portable secrets

Usage:
  ap help [topic]                  Per-command help
  ap -V, --version                 Print version and update status

  ap guide [--human]               Agent contract
  ap show [BUNDLE] [--check]       Readiness (YAML default)
  ap catalog                       Built-in bundle templates
  ap set KEY [-g|--global|--project] [--from-env]
  ap unset KEY [-g|--global|--project]
  ap run [BUNDLE] -- <cmd...>
  ap init [-g|--global] [BUNDLE...]
  ap setup                         Encrypt project secrets (SOPS + 1Password)
  ap edit <secrets|global|project> [--ui]
  ap skill install [--project]
  ap help hooks                    Hook scripts after set/unset

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
