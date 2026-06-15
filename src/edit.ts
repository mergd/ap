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

function editorCommand(): string[] {
  const cmd = process.env.VISUAL || process.env.EDITOR;
  if (cmd) return cmd.split(/\s+/);
  return ["nano"];
}

export async function openInEditor(path: string, target: EditTarget): Promise<number> {
  await seedFile(path, target);
  const parts = editorCommand();
  const proc = Bun.spawn([...parts, path], {
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
