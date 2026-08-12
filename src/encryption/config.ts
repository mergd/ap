import { basename } from "node:path";
import { parse } from "smol-toml";
import { isNotFound, readTextFile, writeTextFile } from "../fs-helpers.ts";
import { projectConfigPath } from "../paths.ts";

export interface EncryptionConfig {
  opVault: string;
  opItem: string;
  opAccount?: string;
}

export function defaultOpItem(projectRoot: string): string {
  return `${basename(projectRoot)}-ap-age-key`;
}

function parseConfig(raw: Record<string, unknown>, projectRoot: string): EncryptionConfig {
  const opVault = typeof raw.op_vault === "string" ? raw.op_vault : "Personal";
  const opItem =
    typeof raw.op_item === "string" ? raw.op_item : defaultOpItem(projectRoot);
  const opAccount = typeof raw.op_account === "string" ? raw.op_account : undefined;
  return { opVault, opItem, opAccount };
}

export async function loadEncryptionConfig(projectRoot: string): Promise<EncryptionConfig | null> {
  try {
    const raw = parse(await readTextFile(projectConfigPath(projectRoot))) as Record<string, unknown>;
    return parseConfig(raw, projectRoot);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function writeEncryptionConfig(
  projectRoot: string,
  config: Pick<EncryptionConfig, "opVault" | "opItem" | "opAccount">,
): Promise<void> {
  const lines = [
    `op_vault = "${config.opVault}"`,
    `op_item = "${config.opItem}"`,
  ];
  if (config.opAccount) {
    lines.push(`op_account = "${config.opAccount}"`);
  }
  await writeTextFile(projectConfigPath(projectRoot), `${lines.join("\n")}\n`);
}

export function sopsKeyRef(config: EncryptionConfig): string {
  return `op://${config.opVault}/${config.opItem}/password`;
}
