import { loadManifest, saveManifestContent } from "./manifest.ts";
import { createVaultStore } from "./vault.ts";
import {
  globalManifestPath,
  globalSecretsPath,
} from "./paths.ts";

export interface MigrateResult {
  migrated: string[];
  manifestPath: string;
}

/** Move inline secret values from manifest → secrets.json and strip from TOML. */
export async function migrateInlineSecrets(manifestPath: string, secretsPath: string): Promise<MigrateResult> {
  const manifest = await loadManifest(manifestPath);
  if (!manifest) return { migrated: [], manifestPath };

  const migrated: string[] = [];
  const vault = createVaultStore(secretsPath);
  const secrets = await vault.read();
  let dirty = false;

  for (const [key, def] of manifest.vars) {
    if (def.visibility !== "secret" || def.value === undefined) continue;
    if (!(key in secrets)) {
      secrets[key] = def.value;
      migrated.push(key);
    }
    def.value = undefined;
    manifest.vars.set(key, def);
    dirty = true;
  }

  if (migrated.length > 0) {
    await vault.write(secrets);
  }

  if (dirty) {
    await saveManifestContent(manifestPath, manifest);
  }

  return { migrated, manifestPath };
}

export async function migrateAllStores(): Promise<MigrateResult[]> {
  const results: MigrateResult[] = [];

  try {
    results.push(await migrateInlineSecrets(globalManifestPath(), globalSecretsPath()));
  } catch {
    // global manifest may not exist yet
  }

  return results;
}
