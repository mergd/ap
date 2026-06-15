
import { join } from "node:path";
import { runGlobalDoctor, runDoctor } from "./doctor.ts";
import { printDoctor } from "./doctor-format.ts";
import {
  INIT_PROJECT_MANIFEST,
  loadManifest,
  saveManifest,
  saveManifestContent,
  parseManifestContent,
} from "./manifest.ts";
import {
  findProjectRoot,
  globalHome,
  globalManifestPath,
  globalSecretsPath,
  projectManifestPath,
  projectSecretsPath,
  projectVaultDir,
  PROJECT_VAULT_DIR,
} from "./paths.ts";
import { loadResolveContext } from "./resolve.ts";
import { runCommand } from "./run.ts";
import { createVaultStore, readStdinSecret } from "./vault.ts";
import type { Scope } from "./types.ts";
import { getPathsInfo, openInEditor, resolveEditPath, type EditTarget } from "./edit.ts";
import { installSkill } from "./skill-install.ts";
import { printHelp } from "./help.ts";
import { ensureDir, pathExists, readTextFile, writeTextFile } from "./fs-helpers.ts";
import { formatValidateReports, runValidate } from "./validate.ts";
import { printCatalogList } from "./catalog/list.ts";
import { buildManifestFromCatalog, mergeCatalogBundles } from "./catalog/scaffold.ts";

function usage(): void {
  printHelp();
}

function wantsJson(args: string[]): boolean {
  return args.includes("--json");
}

function stripFlags(args: string[]): string[] {
  const result = args.filter((a) => a !== "--json");
  for (const flag of ["--global", "--validate", "--from-env", "--unset"]) {
    const idx = result.indexOf(flag);
    if (idx >= 0) result.splice(idx, 1);
  }
  const bundleIdx = result.indexOf("--bundle");
  if (bundleIdx >= 0) result.splice(bundleIdx, 2);
  return result;
}

function parseBundleFilter(args: string[]): string | undefined {
  const idx = args.indexOf("--bundle");
  return idx >= 0 ? args[idx + 1] : undefined;
}

async function requireProjectRoot(): Promise<string> {
  const root = await findProjectRoot();
  if (!root) {
    console.error("Error: no ap.toml found. Run `ap init` first.");
    process.exit(1);
  }
  return root;
}

async function ensureVarInManifest(
  key: string,
  scope: Scope,
  projectRoot: string | null,
): Promise<void> {
  if (scope === "global") {
    const path = globalManifestPath();
    const manifest = await loadManifest(path);
    if (!manifest) {
      console.error("Error: global manifest not found. Run `ap init --global` first.");
      process.exit(1);
    }
    if (!manifest.vars.has(key)) {
      manifest.vars.set(key, { key, visibility: "secret", scope: "global" });
      await saveManifest(path, manifest.vars);
    }
    return;
  }

  const root = projectRoot ?? await requireProjectRoot();
  const path = projectManifestPath(root);
  const manifest = await loadManifest(path);
  if (!manifest) {
    console.error("Error: no ap.toml found. Run `ap init` first.");
    process.exit(1);
  }
  if (!manifest.vars.has(key)) {
    manifest.vars.set(key, { key, visibility: "secret", scope: "project" });
    await saveManifest(path, manifest.vars);
  }
}

async function cmdInit(global: boolean, bundleNames: string[]): Promise<void> {
  if (global) {
    await ensureDir(globalHome());
    const manifestPath = globalManifestPath();
    const existing = await loadManifest(manifestPath);

    if (!existing) {
      const manifest = buildManifestFromCatalog(bundleNames);
      await saveManifestContent(manifestPath, manifest);
      console.log(`Created ${manifestPath}`);
      console.log(`Bundles: ${[...manifest.bundles.keys()].join(", ")}`);
      return;
    }

    const added = mergeCatalogBundles(existing, bundleNames);
    await saveManifestContent(manifestPath, existing);

    if (added.length > 0) {
      console.log(`Added bundles: ${added.join(", ")}`);
    } else if (bundleNames.length > 0) {
      console.log("All requested bundles already in manifest");
    }
    console.log(`Updated ${manifestPath}`);
    return;
  }

  const root = process.cwd();
  const manifestPath = projectManifestPath(root);

  if (await pathExists(manifestPath)) {
    console.error(`Error: ${manifestPath} already exists`);
    process.exit(1);
  }

  await writeTextFile(manifestPath, INIT_PROJECT_MANIFEST);
  await ensureDir(projectVaultDir(root));

  const gitignorePath = join(root, ".gitignore");
  let gitignore = "";
  if (await pathExists(gitignorePath)) {
    gitignore = await readTextFile(gitignorePath);
  }

  if (!gitignore.includes(PROJECT_VAULT_DIR)) {
    const prefix = gitignore.length > 0 && !gitignore.endsWith("\n") ? "\n" : "";
    await writeTextFile(gitignorePath, gitignore + `${prefix}${PROJECT_VAULT_DIR}/\n`);
  }

  console.log(`Created ${manifestPath}`);
  console.log(`Created ${projectVaultDir(root)}/`);
  console.log(`Updated .gitignore with ${PROJECT_VAULT_DIR}/`);
}

async function cmdSet(
  key: string,
  options: { global: boolean; fromEnv: boolean; unset: boolean },
): Promise<void> {
  const scope: Scope = options.global ? "global" : "project";
  const projectRoot = options.global ? null : await requireProjectRoot();

  if (options.unset) {
    const secretsPath = options.global
      ? globalSecretsPath()
      : projectSecretsPath(projectRoot!);
    const vault = createVaultStore(secretsPath);
    const removed = await vault.unset(key);
    if (!removed) {
      console.error(`Error: ${key} not in vault`);
      process.exit(1);
    }
    console.log(`Unset ${key}`);
    return;
  }

  await ensureVarInManifest(key, scope, projectRoot);

  const value = options.fromEnv ? process.env[key] : await readStdinSecret();
  if (!value) {
    if (options.fromEnv) {
      console.error(`Error: ${key} not set in environment`);
    } else {
      console.error("Error: empty value (pipe secret via stdin)");
    }
    process.exit(1);
  }

  const secretsPath = options.global ? globalSecretsPath() : projectSecretsPath(projectRoot!);
  const vault = createVaultStore(secretsPath);
  await vault.set(key, value);
  console.log(`${options.fromEnv ? "Adopted" : "Set"} ${key} (${scope})`);
}

async function cmdDoctor(
  json: boolean,
  globalOnly: boolean,
  validate: boolean,
  bundleFilter?: string,
): Promise<void> {
  const projectRoot = globalOnly ? null : await findProjectRoot();
  const result = globalOnly
    ? await runGlobalDoctor(bundleFilter)
    : await runDoctor(projectRoot, bundleFilter);

  const validateReports = validate ? await runValidate(projectRoot) : undefined;
  if (validateReports && !validateReports.every((r) => r.ok)) {
    result.ready = false;
  }

  if (json) {
    const output = validateReports ? { ...result, validate: validateReports } : result;
    console.log(JSON.stringify(output, null, 2));
  } else {
    printDoctor(result);
    if (validateReports) formatValidateReports(validateReports, "validate");
  }

  if (!result.ready) process.exit(1);
}

async function cmdRun(cmd: string[], bundleFilter?: string): Promise<void> {
  if (cmd.length === 0) {
    console.error("Error: no command specified (use: ap run -- <cmd>)");
    process.exit(1);
  }

  const code = await runCommand(await findProjectRoot(), cmd, { bundleFilter });
  process.exit(code);
}

function parseEditTarget(raw: string): EditTarget {
  if (raw === "secrets") return "secrets";
  if (raw === "manifest") return "manifest";
  if (raw === "toml") return "toml";
  throw new Error(`Unknown edit target "${raw}" (use: secrets, manifest, toml)`);
}

async function cmdEdit(rest: string[]): Promise<void> {
  const global = rest.includes("--global");
  const raw = rest.find((a) => !a.startsWith("--"));
  if (!raw) {
    console.error("Error: target required (secrets, manifest, toml)");
    process.exit(1);
  }

  const target = parseEditTarget(raw);
  if (target === "toml" && global) {
    console.error("Error: toml is always project-scoped (omit --global)");
    process.exit(1);
  }

  const useGlobal = target === "toml" ? false : target === "manifest" ? true : global;
  if (target === "secrets" && !useGlobal && !(await findProjectRoot())) {
    console.error("Error: no ap.toml found. Use --global or run `ap init` first.");
    process.exit(1);
  }

  const path = resolveEditPath(target, useGlobal, await getPathsInfo());

  console.error(`Editing ${path}`);
  const code = await openInEditor(path, target);
  process.exit(code);
}

async function cmdSkillInstall(project: boolean): Promise<void> {
  const scope = project ? "project" : "global";
  const dest = await installSkill(scope);
  console.log(`Installed skill → ${dest}`);
  if (!project) {
    console.log("Available in all Cursor projects (personal skill).");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  const json = wantsJson(args);
  const positional = stripFlags(args);

  if (positional[0] === "help") {
    printHelp(positional[1]);
    return;
  }

  try {
    if (positional[0] === "catalog") {
      const sub = positional[1];
      if (sub === "list") {
        printCatalogList(json);
        return;
      }
      console.error("Unknown catalog command. Use: ap catalog list");
      process.exit(1);
    }

    if (positional[0] === "skill") {
      const sub = positional[1];
      if (sub === "install") {
        await cmdSkillInstall(args.includes("--project"));
        return;
      }
      console.error("Unknown skill command. Use: ap skill install [--project]");
      process.exit(1);
    }

    const cmd = positional[0];
    const rest = stripFlags(positional.slice(1));

    switch (cmd) {
      case "init": {
        const global = args.includes("--global");
        const bundleNames = rest.filter((a) => !a.startsWith("--"));
        await cmdInit(global, bundleNames);
        break;
      }
      case "set": {
        const key = rest.find((a) => !a.startsWith("--"));
        if (!key) {
          console.error("Error: KEY required");
          process.exit(1);
        }
        await cmdSet(key, {
          global: args.includes("--global"),
          fromEnv: args.includes("--from-env"),
          unset: args.includes("--unset"),
        });
        break;
      }
      case "doctor":
        await cmdDoctor(
          json,
          args.includes("--global"),
          args.includes("--validate"),
          parseBundleFilter(args),
        );
        break;
      case "run": {
        const dashIndex = args.indexOf("--");
        const cmdArgs = dashIndex >= 0 ? args.slice(dashIndex + 1) : rest;
        await cmdRun(cmdArgs, parseBundleFilter(args));
        break;
      }
      case "edit":
        await cmdEdit(rest);
        break;
      default:
        console.error(`Unknown command: ${cmd}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}

export { parseManifestContent };
