import { globalHome, globalManifestPath, globalSecretsPath } from "./paths.ts";
import type { AgentGuide } from "./types.ts";
import { printMachineOutput, type OutputFormat } from "./agent-output.ts";

const GUIDE_VERSION = 2;

export function buildAgentGuide(): AgentGuide {
  return {
    version: GUIDE_VERSION,
    workflow: [
      { run: "ap show <name> --check" },
      {
        if_not_ready:
          "show missing[].ask + missing[].set_with — never ask user to paste secrets",
      },
      {
        if_ready:
          "use surfaced vars directly; run external calls via ap run <name> --",
      },
    ],
    rules: {
      never_request_secrets_in_chat: true,
      prefer_bundle: true,
    },
    commands: {
      guide: "ap guide [--human]",
      show: "ap show [BUNDLE] [--check] [--human]",
      run: "ap run [BUNDLE] -- <cmd>",
      set: 'echo "$KEY" | ap set KEY [--global]',
      unset: "ap unset KEY [--global]",
    },
    paths: {
      global_manifest: globalManifestPath(),
      global_secrets: globalSecretsPath(),
      project_toml: "ap.toml",
      project_secrets: ".ap/secrets.json",
      project_encryption: ".sops.yaml + .ap/config.toml (run ap setup)",
      global_home: globalHome(),
    },
  };
}

export function formatGuideHuman(): string {
  return [
    "ap guide — agent contract (YAML by default)",
    "",
    "Workflow:",
    "  1. ap show <name> --check",
    "  2. If not ready → show missing[].ask + missing[].set_with",
    "  3. If ready → use surfaced vars; ap run <name> -- <cmd>",
    "",
    "Rules: never request secrets in chat; prefer a bundle name",
    "",
    "Commands: show, run, set, unset",
  ].join("\n");
}

export function printGuide(format: OutputFormat): void {
  const guide = buildAgentGuide();
  if (format === "human") {
    console.log(formatGuideHuman());
    return;
  }
  printMachineOutput(guide);
}
