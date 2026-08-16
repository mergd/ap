import { basename } from "node:path";
import { isNotFound, readTextFile } from "../fs-helpers.ts";
import {
  emptyManifest,
  loadManifest,
  parseManifestContent,
  saveManifestContent,
} from "../manifest.ts";
import { projectManifestPath } from "../paths.ts";
import type { Manifest, ManifestEncryption } from "../types.ts";

export type EncryptionConfig = ManifestEncryption;

export function defaultOpItem(projectRoot: string): string {
  return `${basename(projectRoot)}-ap-age-key`;
}

export async function loadEncryptionConfig(projectRoot: string): Promise<EncryptionConfig | null> {
  const manifest = await loadManifest(projectManifestPath(projectRoot));
  return manifest?.encryption ?? null;
}

export async function writeEncryptionConfig(
  projectRoot: string,
  config: Pick<EncryptionConfig, "opVault" | "opItem" | "opAccount">,
): Promise<void> {
  const path = projectManifestPath(projectRoot);
  let manifest: Manifest;
  try {
    manifest = parseManifestContent(await readTextFile(path), path);
  } catch (err) {
    if (isNotFound(err)) {
      manifest = emptyManifest("project");
    } else {
      throw err;
    }
  }

  manifest.encryption = {
    opVault: config.opVault,
    opItem: config.opItem,
    ...(config.opAccount ? { opAccount: config.opAccount } : {}),
  };
  await saveManifestContent(path, manifest);
}

export function sopsKeyRef(config: EncryptionConfig): string {
  return `op://${config.opVault}/${config.opItem}/password`;
}
