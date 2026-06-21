import type { CommandSpec } from "./types.ts";
import { printMachineOutput, type OutputFormat } from "./agent-output.ts";

const COMMANDS: CommandSpec[] = [
  {
    name: "guide",
    summary: "Agent contract — workflow, rules, paths (YAML default)",
    agent: true,
    flags: ["--human"],
  },
  {
    name: "doctor",
    summary: "Bundle readiness check (YAML default)",
    agent: true,
    flags: ["--human", "--bundle NAME", "--global", "--validate"],
  },
  {
    name: "run",
    summary: "Inject secrets and run a command",
    agent: true,
    flags: ["--bundle NAME"],
    usage: "ap run [--bundle NAME] -- <cmd...>",
  },
  {
    name: "set",
    summary: "Store or remove a secret",
    agent: true,
    flags: ["--global", "--from-env", "--unset"],
    usage: "echo \"$KEY\" | ap set KEY [--global]",
  },
  {
    name: "commands",
    summary: "List subcommands, flags, and agent relevance (YAML default)",
    agent: true,
    flags: ["--human"],
  },
  {
    name: "init",
    summary: "Scaffold project or global manifest",
    flags: ["--global"],
    usage: "ap init [--global] [BUNDLE...]",
  },
  {
    name: "catalog",
    summary: "Catalog bundle templates",
    subcommands: [
      {
        name: "list",
        summary: "Available bundle templates (YAML default)",
        flags: ["--human"],
      },
    ],
  },
  {
    name: "edit",
    summary: "Open manifests or secrets in $EDITOR",
    flags: ["--global"],
    usage: "ap edit <secrets|manifest|toml> [--global]",
  },
  {
    name: "skill",
    summary: "Install agent skill (Cursor, Claude Code, Codex)",
    subcommands: [
      {
        name: "install",
        summary: "Generate skill from ap guide",
        flags: ["--project"],
      },
    ],
  },
  {
    name: "help",
    summary: "Per-command help",
    usage: "ap help [topic]",
  },
];

export function buildCommandsOutput(): { version: number; commands: CommandSpec[] } {
  return { version: 1, commands: COMMANDS };
}

export function printCommands(format: OutputFormat): void {
  const data = buildCommandsOutput();
  if (format === "human") {
    const lines = ["ap commands", ""];
    for (const cmd of COMMANDS) {
      const tag = cmd.agent ? " [agent]" : "";
      lines.push(`  ${cmd.name}${tag}`);
      if (cmd.summary) lines.push(`    ${cmd.summary}`);
      if (cmd.usage) lines.push(`    ${cmd.usage}`);
      if (cmd.flags?.length) lines.push(`    flags: ${cmd.flags.join(", ")}`);
      if (cmd.subcommands) {
        for (const sub of cmd.subcommands) {
          lines.push(`    ${cmd.name} ${sub.name}`);
          if (sub.flags?.length) lines.push(`      flags: ${sub.flags.join(", ")}`);
        }
      }
      lines.push("");
    }
    console.log(lines.join("\n"));
    return;
  }
  printMachineOutput(data);
}
