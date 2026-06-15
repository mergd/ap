import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile } from "node:fs/promises";
import { ensureDir, pathExists } from "./fs-helpers.ts";
import { findProjectRoot } from "./paths.ts";

export function bundledSkillPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", ".cursor", "skills", "ap", "SKILL.md");
}

export function globalSkillDir(): string {
  return join(process.env.HOME ?? "", ".cursor", "skills", "ap");
}

export function projectSkillDir(projectRoot: string): string {
  return join(projectRoot, ".cursor", "skills", "ap");
}

export async function installSkill(scope: "global" | "project"): Promise<string> {
  const source = bundledSkillPath();
  if (!(await pathExists(source))) {
    throw new Error(`Bundled skill not found at ${source}`);
  }

  let destDir: string;
  if (scope === "global") {
    destDir = globalSkillDir();
  } else {
    const root = await findProjectRoot() ?? process.cwd();
    destDir = projectSkillDir(root);
  }

  await ensureDir(destDir);
  const dest = join(destDir, "SKILL.md");
  await copyFile(source, dest);
  return dest;
}
