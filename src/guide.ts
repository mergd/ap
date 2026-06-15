import { globalHome, globalManifestPath, globalSecretsPath } from "./paths.ts";
import type { AgentGuide } from "./types.ts";
import { printMachineOutput, type OutputFormat } from "./agent-output.ts";

const GUIDE_VERSION = 1;

export function buildAgentGuide(): AgentGuide {
  return {
    version: GUIDE_VERSION,
    workflow: [
      { run: "ap doctor --bundle <name>" },
      {
        if_not_ready:
          "show missing[].ask + missing[].set_with — never ask user to paste secrets",
      },
      {
        if_ready:
          "use surfaced vars directly; run external calls via ap run --bundle <name> --",
      },
    ],
    rules: {
      never_request_secrets_in_chat: true,
      prefer_bundle_filter: true,
    },
    commands: {
      guide: "ap guide [--human]",
      doctor: "ap doctor [--bundle NAME] [--human]",
      run: "ap run [--bundle NAME] -- <cmd>",
      set: 'echo "$KEY" | ap set KEY [--global]',
      commands: "ap commands [--human]",
    },
    paths: {
      global_manifest: globalManifestPath(),
      global_secrets: globalSecretsPath(),
      project_toml: "ap.toml",
      project_secrets: ".ap/secrets.json",
      global_home: globalHome(),
    },
  };
}

export function formatGuideHuman(): string {
  return [
    "ap guide — agent contract (YAML by default)",
    "",
    "Workflow:",
    "  1. ap doctor --bundle <name>",
    "  2. If not ready → show missing[].ask + missing[].set_with",
    "  3. If ready → use surfaced vars; ap run --bundle <name> -- <cmd>",
    "",
    "Rules: never request secrets in chat; prefer --bundle filter",
    "",
    "Commands: guide, doctor, run, set, commands",
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
