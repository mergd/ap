import { isFileGitTracked } from "./git.ts";
import { isSopsEncrypted } from "./encryption/sops.ts";
import {
  findProjectRoot,
  globalManifestPath,
  projectManifestPath,
  projectSecretsPath,
} from "./paths.ts";
import { loadManifest } from "./manifest.ts";
import { isNotFound, readTextFile } from "./fs-helpers.ts";
import type { Manifest, ValidateReport, Visibility } from "./types.ts";

export interface ValidateVarContext {
  /** When true, inline secret values are rejected. */
  gitTracked?: boolean;
  /** Shown in error messages (e.g. ap set KEY --global). */
  setHint?: string;
}

export function validateVarRules(
  key: string,
  visibility: Visibility,
  options: { value?: string; derive?: string } & ValidateVarContext,
): void {
  const { value, derive, gitTracked, setHint } = options;

  if (visibility === "secret" && value !== undefined && gitTracked) {
    const hint = setHint ?? `ap set ${key}`;
    throw new Error(
      `${key}: secret value in a git-tracked manifest — use vault instead (${hint})`,
    );
  }

  if (visibility === "public" && derive && value !== undefined) {
    throw new Error(`${key}: use either value or derive, not both`);
  }

  if (derive && visibility !== "public") {
    throw new Error(`${key}: derive requires visibility = "public"`);
  }
}

/** Validate parsed manifest structure and cross-references. */
export async function validateManifest(
  manifest: Manifest,
  source: string,
  options?: { requireBundleVarDefs?: boolean; gitTracked?: boolean; globalManifest?: Manifest | null },
): Promise<void> {
  const requireBundleVarDefs = options?.requireBundleVarDefs ?? false;
  const gitTracked = options?.gitTracked ?? (await isFileGitTracked(source));

  for (const [key, def] of manifest.vars) {
    const scope = def.scope ?? "global";
    const setHint = scope === "global" ? `ap set ${key} --global` : `ap set ${key}`;

    validateVarRules(key, def.visibility, {
      value: def.value,
      derive: def.derive,
      gitTracked,
      setHint,
    });
  }

  for (const [name, bundle] of manifest.bundles) {
    for (const varKey of bundle.vars) {
      if (requireBundleVarDefs && !manifest.vars.has(varKey)) {
        throw new Error(`${source}: bundle "${name}" references undefined var "${varKey}"`);
      }
    }
  }

  if (manifest.activeBundles) {
    for (const name of manifest.activeBundles) {
      if (!options?.globalManifest?.bundles.has(name)) {
        throw new Error(
          `${source}: bundle "${name}" not in global manifest — run: ap init --global ${name}`,
        );
      }
    }
  }
}

async function validateManifestFile(
  path: string,
  options?: { requireBundleVarDefs?: boolean },
): Promise<ValidateReport> {
  const report: ValidateReport = { ok: true, path, errors: [], warnings: [] };

  try {
    const manifest = await loadManifest(path);
    if (!manifest) {
      if (path === globalManifestPath()) {
        report.warnings.push("not initialized — run: ap init --global");
        return report;
      }
      report.ok = false;
      report.errors.push("file not found");
      return report;
    }

    const globalManifest =
      path.endsWith("ap.toml") ? await loadManifest(globalManifestPath()) : null;

    await validateManifest(manifest, path, { ...options, globalManifest });

    const gitTracked = await isFileGitTracked(path);
    for (const [, def] of manifest.vars) {
      if (def.visibility === "secret" && def.value !== undefined && !gitTracked) {
        report.warnings.push(
          `${def.key}: inline secret — keep this file out of git or move to secrets.json`,
        );
      }
    }
  } catch (err) {
    report.ok = false;
    report.errors.push(err instanceof Error ? err.message : String(err));
  }

  return report;
}

export async function runValidate(projectRoot?: string | null): Promise<ValidateReport[]> {
  const reports: ValidateReport[] = [];

  reports.push(
    await validateManifestFile(globalManifestPath(), { requireBundleVarDefs: true }),
  );

  const root = projectRoot === undefined ? await findProjectRoot() : projectRoot;
  if (root) {
    reports.push(await validateManifestFile(projectManifestPath(root)));
    reports.push(await validateProjectSecrets(root));
  }

  return reports;
}

async function validateProjectSecrets(projectRoot: string): Promise<ValidateReport> {
  const path = projectSecretsPath(projectRoot);
  const report: ValidateReport = { ok: true, path, errors: [], warnings: [] };

  try {
    const content = await readTextFile(path);
    const tracked = await isFileGitTracked(path);

    if (tracked && !isSopsEncrypted(content)) {
      report.ok = false;
      report.errors.push("plaintext secrets tracked in git — run: ap setup");
    } else if (!tracked && !isSopsEncrypted(content)) {
      report.warnings.push("plaintext secrets — run: ap setup to encrypt for git");
    }
  } catch (err) {
    if (!isNotFound(err)) {
      report.ok = false;
      report.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return report;
}

export function formatValidateReports(reports: ValidateReport[], heading = "validate"): void {
  console.log("");
  console.log(`  ${heading}`);
  console.log("");

  for (const r of reports) {
    const status = r.ok ? "ok" : "invalid";
    console.log(`  ${r.path}  ${status}`);
    for (const e of r.errors) console.log(`    error: ${e}`);
    for (const w of r.warnings) console.log(`    warn:  ${w}`);
  }

  console.log("");
}
