import { unlink } from "node:fs/promises";
import { loadManifest, saveManifestContent, emptyManifest } from "./manifest.ts";
import { createVaultStore } from "./vault.ts";
import {
  globalHome,
  globalManifestPath,
  globalSecretsPath,
  projectManifestPath,
  projectSecretsPath,
} from "./paths.ts";
import { ensureDir, isNotFound, pathExists } from "./fs-helpers.ts";
import type { VarDefinition } from "./types.ts";

export interface MigrateResult {
  manifestPath: string;
  /** Keys moved from global secrets.json into TOML value = */
  migrated: string[];
  /** Keys annotated with storage = "secrets.json" */
  annotated: string[];
  deletedSecretsJson?: string;
}

/** Move global secrets.json → inline values in manifest.toml, then delete the JSON file. */
export async function migrateGlobalVaultToToml(): Promise<MigrateResult> {
  const manifestPath = globalManifestPath();
  const secretsPath = globalSecretsPath();
  const result: MigrateResult = {
    manifestPath,
    migrated: [],
    annotated: [],
  };

  if (!(await pathExists(secretsPath))) {
    return result;
  }

  await ensureDir(globalHome());
  let manifest = await loadManifest(manifestPath);
  if (!manifest) {
    manifest = emptyManifest("global");
  }

  const vault = createVaultStore(secretsPath);
  const secrets = await vault.read();

  for (const [key, value] of Object.entries(secrets)) {
    const existing = manifest.vars.get(key);
    const def: VarDefinition = {
      ...(existing ?? { key, visibility: "secret", scope: "global" }),
      key,
      visibility: existing?.visibility ?? "secret",
      scope: "global",
      value,
    };
    delete def.storage;
    manifest.vars.set(key, def);
    result.migrated.push(key);
  }

  if (result.migrated.length > 0) {
    await saveManifestContent(manifestPath, manifest);
  }

  try {
    await unlink(secretsPath);
    result.deletedSecretsJson = secretsPath;
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  return result;
}

/**
 * Annotate vault-backed project secrets with explicit storage = "secrets.json".
 * Does not invent vault entries — only declares keys already present in secrets.json.
 */
export async function annotateProjectVaultStorage(
  projectRoot: string,
): Promise<MigrateResult> {
  const manifestPath = projectManifestPath(projectRoot);
  const result: MigrateResult = {
    manifestPath,
    migrated: [],
    annotated: [],
  };

  const secretsPath = projectSecretsPath(projectRoot);
  if (!(await pathExists(secretsPath))) {
    return result;
  }

  let manifest = await loadManifest(manifestPath);
  if (!manifest) {
    return result;
  }

  const vault = createVaultStore(secretsPath, { projectRoot });
  const secrets = await vault.read();
  let dirty = false;

  for (const key of Object.keys(secrets)) {
    const existing = manifest.vars.get(key);
    if (existing?.storage === "secrets.json") continue;
    if (existing?.value !== undefined) continue;

    const def: VarDefinition = {
      ...(existing ?? { key, visibility: "secret", scope: "project" }),
      key,
      visibility: existing?.visibility ?? "secret",
      scope: "project",
      storage: "secrets.json",
    };
    delete def.value;
    manifest.vars.set(key, def);
    result.annotated.push(key);
    dirty = true;
  }

  if (dirty) {
    await saveManifestContent(manifestPath, manifest);
  }

  return result;
}

export async function migrateAllStores(
  projectRoot?: string | null,
): Promise<MigrateResult[]> {
  const results: MigrateResult[] = [];
  results.push(await migrateGlobalVaultToToml());
  if (projectRoot) {
    results.push(await annotateProjectVaultStorage(projectRoot));
  }
  return results;
}
