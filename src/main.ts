import { runGlobalDoctor, runDoctor } from "./doctor.ts";
import { printShow } from "./doctor-format.ts";
import {
  INIT_PROJECT_MANIFEST,
  loadManifest,
  saveManifestContent,
  parseManifestContent,
  emptyManifest,
} from "./manifest.ts";
import {
  findProjectRoot,
  globalHome,
  globalManifestPath,
  projectManifestPath,
  projectSecretsPath,
  projectVaultDir,
} from "./paths.ts";
import { runCommand } from "./run.ts";
import { createVaultStore, readStdinSecret } from "./vault.ts";
import type { Scope, VarDefinition } from "./types.ts";
import { getPathsInfo, openInEditor, parseEditTarget, resolveEditPath, resolveEditScope } from "./edit.ts";
import { installSkill, checkSkillInstallTip } from "./skill-install.ts";
import { printHelp } from "./help.ts";
import { ensureDir, pathExists, writeTextFile } from "./fs-helpers.ts";
import { formatValidateReports, runValidate } from "./validate.ts";
import {
  buildManifestFromCatalog,
  mergeCatalogBundles,
  resolveCatalogBundleNames,
} from "./catalog/scaffold.ts";
import { printCatalog } from "./catalog/list.ts";
import { printGuide } from "./guide.ts";
import { formatSetupHuman, initEncryptionConfig, runEncryptionSetup } from "./encryption/setup.ts";
import {
  parseOutputFormat,
  printMachineOutput,
  rejectRemovedFlags,
  showToAgentOutput,
  stripOutputFlags,
} from "./agent-output.ts";
import {
  checkForUpdate,
  formatUpdateNotice,
  formatVersionOutput,
  lookupLatestVersion,
  readCurrentVersion,
} from "./update-check.ts";
import { startUi } from "./ui.ts";

function usage(): void {
  printHelp();
}

function hasGlobalFlag(args: string[]): boolean {
  return args.includes("--global") || args.includes("-g");
}

function stripFlags(args: string[]): string[] {
  const result = stripOutputFlags(args);
  for (const flag of ["--global", "-g", "--project", "--validate", "--check", "--from-env", "--human", "--no-open"]) {
    const idx = result.indexOf(flag);
    if (idx >= 0) result.splice(idx, 1);
  }
  const bundleIdx = result.indexOf("--bundle");
  if (bundleIdx >= 0) result.splice(bundleIdx, 2);
  const portIdx = result.indexOf("--port");
  if (portIdx >= 0) result.splice(portIdx, 2);
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

/** Default scope is global; --project selects the repo vault. -g/--global kept as explicit. */
function resolveSetScope(args: string[]): Scope {
  if (args.includes("--project") && hasGlobalFlag(args)) {
    console.error("Error: use either --project or -g/--global, not both");
    process.exit(1);
  }
  return args.includes("--project") ? "project" : "global";
}

/** Ensure a secret var stub exists in the target manifest. */
async function ensureVarInManifest(
  key: string,
  scope: Scope,
  projectRoot: string | null,
): Promise<void> {
  if (scope === "global") {
    await ensureDir(globalHome());
    const path = globalManifestPath();
    let manifest = await loadManifest(path);
    if (!manifest) {
      manifest = emptyManifest("global");
    }
    if (!manifest.vars.has(key)) {
      manifest.vars.set(key, { key, visibility: "secret", scope: manifest.scope });
      await saveManifestContent(path, manifest);
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
    manifest.vars.set(key, {
      key,
      visibility: "secret",
      scope: manifest.scope,
    });
    await saveManifestContent(path, manifest);
  }
}

async function setGlobalManifestValue(key: string, value: string): Promise<void> {
  const path = globalManifestPath();
  let manifest = await loadManifest(path);
  if (!manifest) {
    manifest = emptyManifest("global");
  }
  const existing = manifest.vars.get(key);
  const def: VarDefinition = {
    ...(existing ?? { key, visibility: "secret", scope: "global" }),
    key,
    visibility: existing?.visibility ?? "secret",
    scope: "global",
    value,
  };
  manifest.vars.set(key, def);
  await saveManifestContent(path, manifest);
}

async function unsetGlobalManifestValue(key: string): Promise<boolean> {
  const path = globalManifestPath();
  const manifest = await loadManifest(path);
  if (!manifest) return false;
  const existing = manifest.vars.get(key);
  if (!existing || existing.value === undefined) return false;
  delete existing.value;
  manifest.vars.set(key, existing);
  await saveManifestContent(path, manifest);
  return true;
}

async function cmdInit(global: boolean, bundleNames: string[]): Promise<void> {
  if (global) {
    await ensureDir(globalHome());
    const manifestPath = globalManifestPath();
    const existing = await loadManifest(manifestPath);

    if (!existing) {
      const seeded = resolveCatalogBundleNames(bundleNames);
      const manifest = buildManifestFromCatalog(bundleNames);
      await saveManifestContent(manifestPath, manifest);
      console.log(`Created ${manifestPath}`);
      console.log(`Seeded vars for: ${seeded.join(", ")}`);
      return;
    }

    const added = mergeCatalogBundles(existing, bundleNames);
    await saveManifestContent(manifestPath, existing);

    if (added.length > 0) {
      console.log(`Seeded vars for: ${added.join(", ")}`);
    } else if (bundleNames.length > 0) {
      console.log("All requested catalog vars already in manifest");
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
  await writeTextFile(projectSecretsPath(root), "{}\n");
  await initEncryptionConfig(root);
  const skillDests = await installSkill("project", { projectRoot: root });

  console.log(`Created ${manifestPath}`);
  console.log(`Created ${projectSecretsPath(root)}`);
  console.log(`Installed skill →`);
  for (const dest of skillDests) {
    console.log(`  ${dest}`);
  }
  console.log(`Next: eval "$(op signin)" && ap setup`);
}

async function cmdSetup(): Promise<void> {
  const root = await requireProjectRoot();
  const result = await runEncryptionSetup(root);
  console.log(formatSetupHuman(result));
}

async function cmdSet(
  key: string,
  options: { scope: Scope; fromEnv: boolean },
): Promise<void> {
  const projectRoot = options.scope === "project" ? await requireProjectRoot() : null;

  const value = options.fromEnv ? process.env[key] : await readStdinSecret();
  if (!value) {
    if (options.fromEnv) {
      console.error(`Error: ${key} not set in environment`);
    } else {
      console.error("Error: empty value (pipe secret via stdin)");
    }
    process.exit(1);
  }

  if (options.scope === "global") {
    await ensureDir(globalHome());
    await setGlobalManifestValue(key, value);
    console.log(`${options.fromEnv ? "Adopted" : "Set"} ${key} (global)`);
    return;
  }

  await ensureVarInManifest(key, "project", projectRoot);
  const vault = createVaultStore(projectSecretsPath(projectRoot!), {
    projectRoot,
  });
  await vault.set(key, value);
  console.log(`${options.fromEnv ? "Adopted" : "Set"} ${key} (project)`);
}

async function cmdShow(
  format: ReturnType<typeof parseOutputFormat>,
  globalOnly: boolean,
  validate: boolean,
  check: boolean,
  bundleFilter?: string,
): Promise<void> {
  const projectRoot = globalOnly ? null : await findProjectRoot();
  const result = globalOnly
    ? await runGlobalDoctor(bundleFilter)
    : await runDoctor(projectRoot, bundleFilter);

  const validateReports = validate ? await runValidate(projectRoot) : undefined;
  if (validateReports && !validateReports.every((r) => r.ok)) result.ready = false;
  if (validateReports) result.validate = validateReports;

  if (format === "yaml") printMachineOutput(showToAgentOutput(result));
  else {
    printShow(result);
    if (validateReports) formatValidateReports(validateReports, "validate");
  }

  if (check && !result.ready) process.exit(1);
}

async function cmdUnset(key: string, scope: Scope): Promise<void> {
  if (scope === "global") {
    const removed = await unsetGlobalManifestValue(key);
    if (!removed) {
      console.error(`Error: ${key} has no inline value in global manifest`);
      process.exit(1);
    }
    console.log(`Unset ${key} (global)`);
    return;
  }

  const projectRoot = await requireProjectRoot();
  const vault = createVaultStore(projectSecretsPath(projectRoot), { projectRoot });
  const removed = await vault.unset(key);
  if (!removed) {
    console.error(`Error: ${key} not in project secrets.json`);
    process.exit(1);
  }
  console.log(`Unset ${key} (project)`);
}

async function cmdRun(cmd: string[], bundleFilter?: string): Promise<void> {
  if (cmd.length === 0) {
    console.error("Error: no command specified (use: ap run -- <cmd>)");
    process.exit(1);
  }

  const code = await runCommand(await findProjectRoot(), cmd, { bundleFilter });
  process.exit(code);
}

function parsePortFlag(args: string[]): number | undefined {
  const idx = args.indexOf("--port");
  if (idx < 0) return undefined;
  const portRaw = args[idx + 1];
  const port = portRaw !== undefined ? Number(portRaw) : NaN;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error("Error: --port must be an integer 1–65535");
    process.exit(1);
  }
  return port;
}

async function cmdEdit(args: string[], rest: string[]): Promise<void> {
  const useUi = args.includes("--ui");
  const globalFlag = hasGlobalFlag(args);
  const raw = rest.find((a) => !a.startsWith("--"));

  if (useUi) {
    if (raw === "secrets") {
      console.error('Error: --ui only edits TOML (use: ap edit --ui or ap edit global --ui)');
      process.exit(1);
    }

    let global = globalFlag;
    if (raw) {
      let target;
      try {
        target = parseEditTarget(raw);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
      if (target === "manifest") global = true;
      else if (globalFlag) {
        console.error("Error: project is always project-scoped (omit -g/--global)");
        process.exit(1);
      } else {
        global = false;
      }
    }

    await startUi({
      global,
      port: parsePortFlag(args),
      open: !args.includes("--no-open"),
    });
    return;
  }

  if (!raw) {
    console.error("Error: target required (secrets, global, project) — or pass --ui");
    process.exit(1);
  }

  let target;
  try {
    target = parseEditTarget(raw);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const project = await findProjectRoot();
  const scope = resolveEditScope(target, globalFlag, project !== null);

  if (scope.error) {
    console.error(`Error: ${scope.error}`);
    process.exit(1);
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

  if (args.includes("--version") || args.includes("-V")) {
    const current = await readCurrentVersion();
    const latest = await lookupLatestVersion();
    console.log(formatVersionOutput(current, latest));
    return;
  }

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    usage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  try {
    rejectRemovedFlags(args);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const format = parseOutputFormat(args);
  const positional = stripFlags(args);

  const update = await checkForUpdate();
  if (update) console.error(formatUpdateNotice(update));

  if (positional[0] !== "skill") {
    const skillTip = await checkSkillInstallTip();
    if (skillTip) console.error(skillTip);
  }

  if (positional[0] === "help") {
    printHelp(positional[1]);
    return;
  }

  try {
    if (positional[0] === "guide") {
      printGuide(format);
      return;
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
        const global = hasGlobalFlag(args);
        const bundleNames = rest.filter((a) => !a.startsWith("-"));
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
          scope: resolveSetScope(args),
          fromEnv: args.includes("--from-env"),
        });
        break;
      }
      case "unset": {
        const key = rest.find((a) => !a.startsWith("--"));
        if (!key) {
          console.error("Error: KEY required");
          process.exit(1);
        }
        await cmdUnset(key, resolveSetScope(args));
        break;
      }
      case "show":
        await cmdShow(
          format,
          hasGlobalFlag(args),
          args.includes("--validate"),
          args.includes("--check"),
          parseBundleFilter(args) ?? rest.find((a) => !a.startsWith("-")),
        );
        break;
      case "doctor":
        console.error("Error: `ap doctor` was renamed — use `ap show`");
        process.exit(1);
        break;
      case "catalog": {
        const sub = rest[0] ?? "list";
        if (sub !== "list") {
          console.error("Unknown catalog command. Use: ap catalog");
          process.exit(1);
        }
        printCatalog(format);
        break;
      }
      case "run": {
        const dashIndex = args.indexOf("--");
        const cmdArgs = dashIndex >= 0 ? args.slice(dashIndex + 1) : rest;
        const positionalBundle = dashIndex > 1
          ? args.slice(1, dashIndex).find((a) => !a.startsWith("--"))
          : undefined;
        await cmdRun(cmdArgs, parseBundleFilter(args) ?? positionalBundle);
        break;
      }
      case "edit":
        await cmdEdit(args, rest);
        break;
      case "setup":
        await cmdSetup();
        break;
      case "ui":
        console.error("Error: `ap ui` moved — use `ap edit --ui`");
        process.exit(1);
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
