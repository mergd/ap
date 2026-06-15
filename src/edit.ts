import { chmod } from "node:fs/promises";
import { dirname } from "node:path";
import {
  findProjectRoot,
  globalHome,
  globalManifestPath,
  globalSecretsPath,
  projectManifestPath,
  projectSecretsPath,
} from "./paths.ts";
import { ensureDir, pathExists, writeSecretFile, writeTextFile } from "./fs-helpers.ts";

export interface ApPathsInfo {
  global_home: string;
  global_manifest: string;
  global_secrets: string;
  project: string | null;
  project_manifest: string | null;
  project_secrets: string | null;
}

export async function getPathsInfo(): Promise<ApPathsInfo> {
  const project = await findProjectRoot();
  return {
    global_home: globalHome(),
    global_manifest: globalManifestPath(),
    global_secrets: globalSecretsPath(),
    project,
    project_manifest: project ? projectManifestPath(project) : null,
    project_secrets: project ? projectSecretsPath(project) : null,
  };
}

export type EditTarget = "secrets" | "manifest" | "ap";

export function resolveEditPath(
  target: EditTarget,
  global: boolean,
  info: ApPathsInfo,
): string {
  switch (target) {
    case "secrets":
      if (global) return info.global_secrets;
      if (!info.project_secrets) {
        throw new Error("No project ap.toml found. Run `ap init` first.");
      }
      return info.project_secrets;
    case "manifest":
      if (global) return info.global_manifest;
      if (!info.project_manifest) {
        throw new Error("No project ap.toml found. Run `ap init` first.");
      }
      return info.project_manifest;
    case "ap":
      if (global) return info.global_manifest;
      if (!info.project_manifest) {
        throw new Error("No project ap.toml found. Run `ap init` first.");
      }
      return info.project_manifest;
  }
}

async function seedFile(path: string, target: EditTarget): Promise<void> {
  if (await pathExists(path)) return;

  await ensureDir(dirname(path));

  if (target === "secrets") {
    await writeSecretFile(path, "{}\n");
    return;
  }

  if (path.endsWith("manifest.toml")) {
    await writeTextFile(path, "version = 1\n\n");
    return;
  }

  await writeTextFile(path, "version = 1\n\nbundles = []\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** GUI editors return immediately; terminal editors block until quit. */
export function isDetachedEditor(editor: string | undefined): boolean {
  if (!editor) return false;
  const base = editor.trim().split(/\s+/)[0] ?? editor;
  const name = base.split("/").pop() ?? base;
  return /^(code|cursor|windsurf|open|subl|bbedit|mate)$/i.test(name);
}

function buildEditorShellCommand(path: string): string {
  const editor = process.env.VISUAL || process.env.EDITOR;
  const quoted = shellQuote(path);

  if (!editor) return `nano ${quoted}`;

  // Strip --wait if set; ap should not block on GUI editors
  const cmd = isDetachedEditor(editor) ? editor.replace(/\s+--wait\b/, "") : editor;
  return `${cmd} ${quoted}`;
}

function shellInvokeArgs(command: string): [string, string[]] {
  const shell = process.env.SHELL || "/bin/zsh";
  const name = shell.split("/").pop() ?? "zsh";

  // Aliases (e.g. code → cursor) need an interactive login shell
  if (name === "fish") return [shell, ["-lc", command]];
  return [shell, ["-lic", command]];
}

export async function openInEditor(path: string, target: EditTarget): Promise<number> {
  await seedFile(path, target);

  if (target === "secrets" && process.platform !== "win32" && (await pathExists(path))) {
    await chmod(path, 0o600);
  }

  const editor = process.env.VISUAL || process.env.EDITOR;
  const detached = isDetachedEditor(editor);
  const [shell, args] = shellInvokeArgs(buildEditorShellCommand(path));

  if (detached) {
    Bun.spawn([shell, ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return 0;
  }

  const proc = Bun.spawn([shell, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code === 0 && target === "secrets" && process.platform !== "win32") {
    await chmod(path, 0o600);
  }
  return code;
}

export function printPaths(info: ApPathsInfo, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  console.log("");
  console.log("  ap paths");
  console.log("");
  console.log("  Global (~/.config/ap/)");
  console.log(`    manifest   ${info.global_manifest}   bundles + public vars`);
  console.log(`    secrets    ${info.global_secrets}   secret values (edit here)`);
  console.log("");
  if (info.project) {
    console.log(`  Project (${info.project})`);
    console.log(`    ap.toml    ${info.project_manifest}   bundles this repo uses`);
    console.log(`    secrets    ${info.project_secrets}   project-only secrets`);
  } else {
    console.log("  Project    (none — run from a repo with ap.toml)");
  }
  console.log("");
  console.log("  Edit");
  console.log("    ap edit secrets --global     secret values");
  console.log("    ap edit manifest --global    bundles + public vars");
  console.log("    ap edit ap                   project ap.toml");
  console.log("");
}
