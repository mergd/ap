import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnAsync } from "../spawn.ts";
import type { EncryptionConfig } from "./config.ts";
import { sopsKeyRef } from "./config.ts";

interface OpItem {
  title: string;
  id: string;
}

interface OpVault {
  name: string;
}

async function opSpawn(
  args: string[],
  config?: Pick<EncryptionConfig, "opAccount">,
): Promise<{ code: number; stdout: string }> {
  const cmd = config?.opAccount ? ["--account", config.opAccount, ...args] : args;
  return spawnAsync("op", cmd, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
}

export async function requireOpSignedIn(config?: Pick<EncryptionConfig, "opAccount">): Promise<void> {
  const { code } = await opSpawn(["whoami"], config);
  if (code !== 0) {
    throw new Error("1Password CLI not signed in. Run: eval \"$(op signin)\"");
  }
}

export async function resolveVault(
  requested: string,
  config?: Pick<EncryptionConfig, "opAccount">,
): Promise<string> {
  const primary = await opSpawn(["vault", "get", requested], config);
  if (primary.code === 0) return requested;

  for (const fallback of ["Personal", "Private"]) {
    if (fallback === requested) continue;
    const result = await opSpawn(["vault", "get", fallback], config);
    if (result.code === 0) return fallback;
  }

  const listed = await opSpawn(["vault", "list", "--format", "json"], config);
  if (listed.code === 0) {
    const vaults = JSON.parse(listed.stdout) as OpVault[];
    if (vaults[0]?.name) return vaults[0].name;
  }

  throw new Error("No 1Password vault found for encryption setup");
}

export async function opItemId(config: EncryptionConfig): Promise<string | null> {
  const { code, stdout } = await opSpawn(
    ["item", "list", "--vault", config.opVault, "--format", "json"],
    config,
  );
  if (code !== 0) return null;

  const items = JSON.parse(stdout) as OpItem[];
  return items.find((item) => item.title === config.opItem)?.id ?? null;
}

export async function readPrivateKey(config: EncryptionConfig): Promise<string> {
  const { code, stdout } = await opSpawn(
    ["read", "--no-newline", sopsKeyRef(config)],
    config,
  );
  if (code !== 0) {
    throw new Error(`Failed to read age key from 1Password (${sopsKeyRef(config)})`);
  }
  return stdout;
}

export async function publicKeyFromPrivate(privateKey: string): Promise<string> {
  const { spawn } = await import("node:child_process");

  const proc = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn("age-keygen", ["-y", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      out += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ code: exitCode ?? 1, stdout: out.trim() }));
    child.stdin.write(privateKey);
    child.stdin.end();
  });

  if (proc.code !== 0) {
    throw new Error("Failed to derive age public key");
  }
  return proc.stdout;
}

async function readLocalAgeKey(): Promise<string | null> {
  const candidates = [
    join(homedir(), "Library", "Application Support", "sops", "age", "keys.txt"),
    join(homedir(), ".config", "sops", "age", "keys.txt"),
  ];

  for (const path of candidates) {
    try {
      return await readFile(path, "utf8");
    } catch {
      continue;
    }
  }
  return null;
}

async function generateAgeKey(): Promise<string> {
  const tmp = join(homedir(), `.ap-age-key-${process.pid}`);
  try {
    const { code } = await spawnAsync("age-keygen", ["-o", tmp], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (code !== 0) throw new Error("age-keygen failed");
    return await readFile(tmp, "utf8");
  } finally {
    await rm(tmp, { force: true });
  }
}

export async function ensureAgeKeyInOnePassword(config: EncryptionConfig): Promise<{
  privateKey: string;
  publicKey: string;
  created: boolean;
}> {
  const existingId = await opItemId(config);

  if (existingId) {
    const privateKey = await readPrivateKey(config);
    const publicKey = await publicKeyFromPrivate(privateKey);
    return { privateKey, publicKey, created: false };
  }

  let privateKey = await readLocalAgeKey();
  if (!privateKey) {
    privateKey = await generateAgeKey();
  }

  const publicKey = await publicKeyFromPrivate(privateKey);
  const { code } = await opSpawn(
    [
      "item",
      "create",
      "--category=password",
      `--vault=${config.opVault}`,
      `--title=${config.opItem}`,
      `password=${privateKey}`,
    ],
    config,
  );

  if (code !== 0) {
    throw new Error(`Failed to create 1Password item: ${config.opItem}`);
  }

  return { privateKey, publicKey, created: true };
}
