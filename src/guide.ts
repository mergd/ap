import { globalHome, globalManifestPath } from "./paths.ts";
import type { AgentGuide } from "./types.ts";
import { printMachineOutput, type OutputFormat } from "./agent-output.ts";

const GUIDE_VERSION = 4;

export function buildAgentGuide(): AgentGuide {
  return {
    version: GUIDE_VERSION,
    workflow: [
      { run: "ap show <name> --check" },
      {
        if_not_ready:
          "show missing[].ask + missing[].set_with / next",
      },
      {
        if_ready:
          "use surfaced vars directly; run external calls via ap run <name> --",
      },
    ],
    rules: {
      prefer_bundle: true,
    },
    commands: {
      guide: "ap guide [--human]",
      show: "ap show [BUNDLE] [--check] [--human]",
      catalog: "ap catalog [--human]",
      run: "ap run [BUNDLE] -- <cmd>",
      set: 'echo "$KEY" | ap set KEY',
      unset: "ap unset KEY",
    },
    paths: {
      global_manifest: globalManifestPath(),
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
    "  2. If not ready → show missing[].ask + missing[].set_with (or next)",
    "  3. If ready → use surfaced vars; ap run <name> -- <cmd>",
    "",
    "Rules: prefer a bundle name on show / run",
    "",
    "Commands: show, catalog, run, set, unset",
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
