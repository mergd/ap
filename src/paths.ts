import { join, resolve } from "node:path";
import { pathExists } from "./fs-helpers.ts";

const PROJECT_MANIFEST_NAME = "ap.toml";
const GLOBAL_MANIFEST_NAME = "manifest.toml";
const PROJECT_VAULT_DIR = ".ap";
const SECRETS_FILE = "secrets.json";

export function globalHome(): string {
  const override = process.env.AP_GLOBAL_HOME;
  if (override) return resolve(override);
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "ap");
  return join(process.env.HOME ?? "", ".config", "ap");
}

export function globalManifestPath(): string {
  return join(globalHome(), GLOBAL_MANIFEST_NAME);
}

export function globalSecretsPath(): string {
  return join(globalHome(), SECRETS_FILE);
}

export function projectVaultDir(projectRoot: string): string {
  return join(projectRoot, PROJECT_VAULT_DIR);
}

export function projectSecretsPath(projectRoot: string): string {
  return join(projectVaultDir(projectRoot), SECRETS_FILE);
}

export function projectManifestPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MANIFEST_NAME);
}

export async function findProjectRoot(
  start = process.cwd(),
): Promise<string | null> {
  let dir = resolve(start);
  const root = resolve("/");

  while (true) {
    if (await pathExists(join(dir, PROJECT_MANIFEST_NAME))) return dir;
    if (dir === root) return null;
    dir = resolve(dir, "..");
  }
}

export { PROJECT_MANIFEST_NAME, PROJECT_VAULT_DIR, SECRETS_FILE };
