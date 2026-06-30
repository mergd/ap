import { pathExists, readTextFile, writeTextFile } from "../fs-helpers.ts";
import { projectLocalConfigExamplePath, projectSecretsPath, projectSopsYamlPath } from "../paths.ts";
import {
  defaultOpItem,
  loadEncryptionConfig,
  sopsKeyRef,
  writeEncryptionConfig,
} from "./config.ts";
import {
  ensureAgeKeyInOnePassword,
  requireOpSignedIn,
  resolveVault,
} from "./onepassword.ts";
import { ensureEncryptedSecretsFile, isSopsEncrypted, writeSopsYaml } from "./sops.ts";

export interface SetupResult {
  projectRoot: string;
  opVault: string;
  opItem: string;
  publicKey: string;
  keyRef: string;
  createdKey: boolean;
  encryptedSecrets: boolean;
}

export async function runEncryptionSetup(projectRoot: string): Promise<SetupResult> {
  let config = await loadEncryptionConfig(projectRoot);
  if (!config) {
    const opItem = defaultOpItem(projectRoot);
    await writeEncryptionConfig(projectRoot, { opVault: "Personal", opItem });
    config = { opVault: "Personal", opItem };
  }

  await requireOpSignedIn(config);
  const resolvedVault = await resolveVault(config.opVault, config);
  if (resolvedVault !== config.opVault) {
    config = { ...config, opVault: resolvedVault };
    await writeEncryptionConfig(projectRoot, config);
  }

  const { publicKey, created } = await ensureAgeKeyInOnePassword(config);
  await writeSopsYaml(projectRoot, publicKey);

  const secretsPath = projectSecretsPath(projectRoot);
  let encryptedSecrets = false;
  if (await pathExists(secretsPath)) {
    const raw = await readTextFile(secretsPath);
    if (!isSopsEncrypted(raw)) {
      await ensureEncryptedSecretsFile(secretsPath, config, projectRoot);
      encryptedSecrets = true;
    }
  } else {
    await ensureEncryptedSecretsFile(secretsPath, config, projectRoot);
    encryptedSecrets = true;
  }

  return {
    projectRoot,
    opVault: config.opVault,
    opItem: config.opItem,
    publicKey,
    keyRef: sopsKeyRef(config),
    createdKey: created,
    encryptedSecrets,
  };
}

export function formatSetupHuman(result: SetupResult): string {
  const lines = [
    "Encryption ready.",
    `  1Password: ${result.keyRef}`,
    `  Public key: ${result.publicKey}`,
    `  SOPS config: ${projectSopsYamlPath(result.projectRoot)}`,
  ];

  if (result.createdKey) {
    lines.push("  Created new age key in 1Password");
  } else {
    lines.push("  Using existing age key in 1Password");
  }

  if (result.encryptedSecrets) {
    lines.push(`  Encrypted ${projectSecretsPath(result.projectRoot)}`);
  }

  lines.push("");
  lines.push("Commit .sops.yaml, .ap/config.toml, and .ap/secrets.json to share secrets safely.");

  return lines.join("\n");
}

export async function writeLocalConfigExample(projectRoot: string): Promise<void> {
  await writeTextFile(
    projectLocalConfigExamplePath(projectRoot),
    `# Copy to .ap/local.toml (gitignored) for local overrides
op_account = ""
`,
  );
}

export async function initEncryptionConfig(projectRoot: string): Promise<void> {
  const opItem = defaultOpItem(projectRoot);
  await writeEncryptionConfig(projectRoot, { opVault: "Personal", opItem });
  await writeLocalConfigExample(projectRoot);
}
