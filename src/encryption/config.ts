import { basename } from "node:path";
import { parse } from "smol-toml";
import { isNotFound, pathExists, readTextFile, writeTextFile } from "../fs-helpers.ts";
import { projectConfigPath, projectLocalConfigPath } from "../paths.ts";

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
    const config = parseConfig(raw, projectRoot);

    if (await pathExists(projectLocalConfigPath(projectRoot))) {
      const local = parse(await readTextFile(projectLocalConfigPath(projectRoot))) as Record<
        string,
        unknown
      >;
      if (typeof local.op_account === "string") {
        config.opAccount = local.op_account;
      }
    }

    return config;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

export async function writeEncryptionConfig(
  projectRoot: string,
  config: Pick<EncryptionConfig, "opVault" | "opItem">,
): Promise<void> {
  const content = `op_vault = "${config.opVault}"
op_item = "${config.opItem}"
`;
  await writeTextFile(projectConfigPath(projectRoot), content);
}

export function sopsKeyRef(config: EncryptionConfig): string {
  return `op://${config.opVault}/${config.opItem}/password`;
}
