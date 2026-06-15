import { dirname } from "node:path";
import { isNotFound, readTextFile, readStdinSecret, writeSecretFile } from "./fs-helpers.ts";
import type { VaultStore } from "./types.ts";

async function readSecretsFile(path: string): Promise<Record<string, string>> {
  try {
    const content = await readTextFile(path);
    const parsed = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Invalid secrets file format: ${path}`);
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  } catch (err) {
    if (isNotFound(err)) return {};
    throw err;
  }
}

async function writeSecretsFile(path: string, secrets: Record<string, string>): Promise<void> {
  await writeSecretFile(path, JSON.stringify(secrets, null, 2) + "\n");
}

export function createVaultStore(secretsPath: string): VaultStore {
  return {
    async read() {
      return await readSecretsFile(secretsPath);
    },

    async write(secrets) {
      await writeSecretsFile(secretsPath, secrets);
    },

    async set(key, value) {
      const secrets = await readSecretsFile(secretsPath);
      secrets[key] = value;
      await writeSecretsFile(secretsPath, secrets);
    },

    async unset(key) {
      const secrets = await readSecretsFile(secretsPath);
      if (!(key in secrets)) return false;
      delete secrets[key];
      await writeSecretsFile(secretsPath, secrets);
      return true;
    },
  };
}

export { readStdinSecret };
