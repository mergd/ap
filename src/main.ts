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
import { runCommand } from "./run.ts";
import { createVaultStore, readStdinSecret } from "./vault.ts";
import type { Scope } from "./types.ts";
import { getPathsInfo, openInEditor, resolveEditPath, resolveEditScope, type EditTarget } from "./edit.ts";
import { installSkill } from "./skill-install.ts";
import { printHelp } from "./help.ts";
import { ensureDir, pathExists, readTextFile, writeTextFile } from "./fs-helpers.ts";
import { formatValidateReports, runValidate } from "./validate.ts";
import { printCatalogList } from "./catalog/list.ts";
import { buildManifestFromCatalog, mergeCatalogBundles } from "./catalog/scaffold.ts";
import { printGuide } from "./guide.ts";
import { printCommands } from "./commands.ts";
import { formatSetupHuman, initEncryptionConfig, runEncryptionSetup } from "./encryption/setup.ts";
import {
  doctorToAgentOutput,
  parseOutputFormat,
  printMachineOutput,
  rejectRemovedFlags,
  stripOutputFlags,
} from "./agent-output.ts";

function usage(): void {
  printHelp();
}

function stripFlags(args: string[]): string[] {
  const result = stripOutputFlags(args);
  for (const flag of ["--global", "--validate", "--from-env", "--unset", "--human"]) {
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
    await writeTextFile(
      gitignorePath,
      gitignore +
        `${prefix}# ap — commit encrypted .ap/secrets.json after ap setup\n` +
        `${PROJECT_VAULT_DIR}/local.toml\n` +
        `${PROJECT_VAULT_DIR}/secrets.plain.json\n`,
    );
  }

  await initEncryptionConfig(root);

  console.log(`Created ${manifestPath}`);
  console.log(`Created ${projectVaultDir(root)}/`);
  console.log(`Updated .gitignore for encrypted secrets`);
  console.log(`Next: eval "$(op signin)" && ap setup`);
}

async function cmdSetup(): Promise<void> {
  const root = await requireProjectRoot();
  const result = await runEncryptionSetup(root);
  console.log(formatSetupHuman(result));
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
    const vault = createVaultStore(secretsPath, {
      projectRoot: options.global ? null : projectRoot,
    });
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
  const vault = createVaultStore(secretsPath, {
    projectRoot: options.global ? null : projectRoot,
  });
  await vault.set(key, value);
  console.log(`${options.fromEnv ? "Adopted" : "Set"} ${key} (${scope})`);
}

async function cmdDoctor(
  format: ReturnType<typeof parseOutputFormat>,
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
  if (validateReports) result.validate = validateReports;

  if (format === "yaml") {
    printMachineOutput(doctorToAgentOutput(result));
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

async function cmdEdit(rest: string[], globalFlag: boolean): Promise<void> {
  const raw = rest.find((a) => !a.startsWith("--"));
  if (!raw) {
    console.error("Error: target required (secrets, manifest, toml)");
    process.exit(1);
  }

  const target = parseEditTarget(raw);
  const project = await findProjectRoot();
  const scope = resolveEditScope(target, globalFlag, project !== null);

  if (scope.error) {
    console.error(`Error: ${scope.error}`);
    process.exit(1);
  }

  if (scope.fallbackToGlobal) {
    console.error("No project ap.toml; editing global secrets.");
  }

  const path = resolveEditPath(target, scope.useGlobal, await getPathsInfo());

  console.error(`Editing ${path}`);
  const code = await openInEditor(path, target, {
    projectRoot: scope.useGlobal ? null : project,
  });
  process.exit(code);
}

async function cmdSkillInstall(project: boolean): Promise<void> {
  const scope = project ? "project" : "global";
  const dests = await installSkill(scope);
  console.log(`Installed skill →`);
  for (const dest of dests) {
    console.log(`  ${dest}`);
  }
  if (!project) {
    console.log("Available in all projects (Cursor, Claude Code, Codex).");
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  rejectRemovedFlags(args);

  const format = parseOutputFormat(args);
  const positional = stripFlags(args);

  if (positional[0] === "help") {
    printHelp(positional[1]);
    return;
  }

  try {
    if (positional[0] === "guide") {
      printGuide(format);
      return;
    }

    if (positional[0] === "commands") {
      printCommands(format);
      return;
    }

    if (positional[0] === "catalog") {
      const sub = positional[1];
      if (sub === "list") {
        printCatalogList(format);
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
          format,
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
        await cmdEdit(rest, args.includes("--global"));
        break;
      case "setup":
        await cmdSetup();
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
