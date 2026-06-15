const topics: Record<string, string> = {
  doctor: `ap doctor — readiness check (primary agent entrypoint)

  ap doctor [--json] [--bundle NAME]

  Checks bundles declared in ap.toml against ~/.config/ap.
  Public values appear in surfaced; secrets never shown in --json.

  Examples:
    ap doctor
    ap doctor --bundle namecheap
    ap doctor --json`,

  edit: `ap edit — open manifests or secrets in $EDITOR

  ap edit [secrets|manifest|ap] [--global]

  secrets   secret values (JSON key/value)
  manifest  bundles + public vars (TOML)
  ap        project ap.toml

  Examples:
    ap edit                      global secrets.json
    ap edit secrets --global
    ap edit manifest --global
    ap edit ap`,

  paths: `ap paths — show file locations

  ap paths [--json]

  Global:
    ~/.config/ap/manifest.toml   bundles, public vars
    ~/.config/ap/secrets.json    secret values

  Project:
    ap.toml                      active bundles
    .ap/secrets.json             project secrets`,

  skill: `ap skill — Cursor agent skill

  ap skill install [--project]

  --project   install to .cursor/skills/ap/ in current repo
  (default)   install to ~/.cursor/skills/ap/ (all projects)`,

  global: `ap global — machine-wide store (~/.config/ap/)

  ap global init
  ap global set KEY              stdin → secrets.json
  ap global list [--json]
  ap global doctor [--json]`,

  run: `ap run — inject secrets and run a command

  ap run -- <cmd...>

  Resolves all bundles in ap.toml, merges env, spawns subprocess.

  Example:
    ap run -- curl -H "Authorization: Bearer $CF_GLOBAL_API_TOKEN" ...`,

  set: `ap set — store a secret (stdin)

  ap set KEY [--global]
  ap adopt KEY [--global]        copy from process.env
  ap unset KEY [--global]

  Examples:
    echo "$KEY" | ap set NC_API_KEY --global
    ap adopt NC_API_KEY --global`,
};

function mainHelp(): string {
  return `ap — agent-portable secrets

Usage:
  ap help [command]                Show help (this message or per-command)

  ap paths [--json]                Where manifests and secrets live
  ap edit [target] [--global]      Open file in $EDITOR
  ap skill install [--project]     Install Cursor agent skill

  ap init                          Scaffold ap.toml + .ap/
  ap set KEY [--global]            Set secret (stdin)
  ap adopt KEY [--global]          Copy from process.env
  ap unset KEY [--global]          Remove from vault
  ap list [--json]                 List keys and status
  ap doctor [--json] [--bundle NAME]   Readiness by bundle
  ap validate                      Check manifests (blocks inline secrets in git)
  ap schema [--json]               Merged manifest export
  ap print KEY [--json]            Public values only
  ap run -- <cmd...>               Resolve secrets, run command

  ap global init                   Scaffold ~/.config/ap/
  ap global set KEY                Machine-wide secret (stdin)
  ap global list [--json]
  ap global doctor [--json]

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
