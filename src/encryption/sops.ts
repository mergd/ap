import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isNotFound, pathExists, readTextFile } from "../fs-helpers.ts";
import { projectSopsYamlPath } from "../paths.ts";
import { spawnAsync } from "../spawn.ts";
import type { EncryptionConfig } from "./config.ts";
import { sopsKeyRef } from "./config.ts";

export function isSopsEncrypted(content: string): boolean {
  return content.includes('"sops"') && content.includes('"enc"');
}

export function sopsYamlContent(publicKey: string): string {
  return `creation_rules:
  - path_regex: \\.ap/secrets\\.json$
    age: ${publicKey}
`;
}

export function sopsEnv(config: EncryptionConfig): Record<string, string> {
  const ref = sopsKeyRef(config);
  return {
    SOPS_AGE_KEY_OP_REF: ref,
    SOPS_AGE_KEY_CMD: `op read --no-newline -- ${ref}`,
  };
}

export async function isEncryptionReady(projectRoot: string): Promise<boolean> {
  return pathExists(projectSopsYamlPath(projectRoot));
}

async function requireSops(): Promise<void> {
  const { code } = await spawnAsync("sops", ["--version"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  if (code !== 0) {
    throw new Error("sops not found — install with: brew install sops age");
  }
}

export async function writeSopsYaml(projectRoot: string, publicKey: string): Promise<void> {
  const path = projectSopsYamlPath(projectRoot);
  const content = sopsYamlContent(publicKey);
  const existing = (await pathExists(path)) ? await readTextFile(path) : "";
  if (existing.includes(publicKey)) return;
  await writeFile(path, content, "utf8");
}

export async function sopsDecryptFile(
  filePath: string,
  config: EncryptionConfig,
  cwd: string,
): Promise<string> {
  await requireSops();
  const { code, stdout } = await spawnAsync("sops", ["--decrypt", filePath], {
    cwd,
    env: sopsEnv(config),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (code !== 0) {
    throw new Error(`Failed to decrypt ${filePath} (is 1Password signed in?)`);
  }
  return stdout;
}

export async function sopsEncryptContent(
  plaintext: string,
  outputPath: string,
  config: EncryptionConfig,
  cwd: string,
): Promise<void> {
  await requireSops();
  const dir = await mkdtemp(join(tmpdir(), "ap-sops-"));
  const input = join(dir, "secrets.json");

  try {
    await writeFile(input, plaintext, "utf8");
    const { code } = await spawnAsync("sops", ["--encrypt", "--output", outputPath, input], {
      cwd,
      env: sopsEnv(config),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (code !== 0) {
      throw new Error(`Failed to encrypt ${outputPath}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function readSecretsContent(
  filePath: string,
  config: EncryptionConfig,
  projectRoot: string,
): Promise<string> {
  try {
    const content = await readTextFile(filePath);
    if (isSopsEncrypted(content)) {
      return await sopsDecryptFile(filePath, config, projectRoot);
    }
    return content;
  } catch (err) {
    if (isNotFound(err)) return "{}\n";
    throw err;
  }
}

export async function sopsEdit(
  filePath: string,
  config: EncryptionConfig,
  cwd: string,
): Promise<number> {
  await requireSops();
  const { code } = await spawnAsync("sops", [filePath], {
    cwd,
    env: sopsEnv(config),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return code;
}

export async function ensureEncryptedSecretsFile(
  secretsPath: string,
  config: EncryptionConfig,
  projectRoot: string,
): Promise<void> {
  let plaintext = "{}\n";

  if (await pathExists(secretsPath)) {
    const raw = await readTextFile(secretsPath);
    if (isSopsEncrypted(raw)) return;
    plaintext = raw.endsWith("\n") ? raw : `${raw}\n`;
  }

  await sopsEncryptContent(plaintext, secretsPath, config, projectRoot);
}
