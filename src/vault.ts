import { dirname } from "node:path";
import { isNotFound, readTextFile, readStdinSecret, writeSecretFile } from "./fs-helpers.ts";
import { loadEncryptionConfig } from "./encryption/config.ts";
import {
  isEncryptionReady,
  readSecretsContent,
  sopsEncryptContent,
} from "./encryption/sops.ts";
import type { VaultStore } from "./types.ts";

export interface VaultOptions {
  projectRoot?: string | null;
}

async function parseSecretsJson(content: string, path: string): Promise<Record<string, string>> {
  const parsed = JSON.parse(content);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid secrets file format: ${path}`);
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

async function readSecretsFile(
  path: string,
  options?: VaultOptions,
): Promise<Record<string, string>> {
  try {
    const projectRoot = options?.projectRoot;
    if (projectRoot && (await isEncryptionReady(projectRoot))) {
      const config = await loadEncryptionConfig(projectRoot);
      if (config) {
        const content = await readSecretsContent(path, config, projectRoot);
        return await parseSecretsJson(content, path);
      }
    }

    const content = await readTextFile(path);
    return await parseSecretsJson(content, path);
  } catch (err) {
    if (isNotFound(err)) return {};
    throw err;
  }
}

async function writeSecretsFile(
  path: string,
  secrets: Record<string, string>,
  options?: VaultOptions,
): Promise<void> {
  const plaintext = JSON.stringify(secrets, null, 2) + "\n";
  const projectRoot = options?.projectRoot;

  if (projectRoot && (await isEncryptionReady(projectRoot))) {
    const config = await loadEncryptionConfig(projectRoot);
    if (!config) {
      throw new Error("Encryption config missing — run: ap setup");
    }
    await sopsEncryptContent(plaintext, path, config, projectRoot);
    return;
  }

  await writeSecretFile(path, plaintext);
}

export function createVaultStore(secretsPath: string, options?: VaultOptions): VaultStore {
  return {
    async read() {
      return await readSecretsFile(secretsPath, options);
    },

    async write(secrets) {
      await writeSecretsFile(secretsPath, secrets, options);
    },

    async set(key, value) {
      const secrets = await readSecretsFile(secretsPath, options);
      secrets[key] = value;
      await writeSecretsFile(secretsPath, secrets, options);
    },

    async unset(key) {
      const secrets = await readSecretsFile(secretsPath, options);
      if (!(key in secrets)) return false;
      delete secrets[key];
      await writeSecretsFile(secretsPath, secrets, options);
      return true;
    },
  };
}

export { readStdinSecret };
