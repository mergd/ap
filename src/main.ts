#!/usr/bin/env bun

import { join } from "node:path";
import { runGlobalDoctor, runDoctor } from "./doctor.ts";
import { printDoctor } from "./doctor-format.ts";
import {
  INIT_GLOBAL_MANIFEST,
  INIT_PROJECT_MANIFEST,
  loadManifest,
  saveManifest,
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
import { exportSchema, loadResolveContext, resolveAll, resolveVar } from "./resolve.ts";
import { runCommand } from "./run.ts";
import { createVaultStore, readStdinSecret } from "./vault.ts";
import type { Scope, VarDefinition } from "./types.ts";
import { getPathsInfo, openInEditor, printPaths, resolveEditPath, type EditTarget } from "./edit.ts";
import { installSkill } from "./skill-install.ts";
import { printHelp } from "./help.ts";
import { ensureDir, pathExists, readTextFile, writeTextFile } from "./fs-helpers.ts";
import { formatValidateReports, runValidate } from "./validate.ts";
import { printCatalogList } from "./catalog/list.ts";

function usage(): void {
  printHelp();
}

function wantsJson(args: string[]): boolean {
  return args.includes("--json");
}

function stripFlags(args: string[]): string[] {
  const result = args.filter((a) => a !== "--json");
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
      console.error("Error: global manifest not found. Run `ap global init` first.");
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

async function cmdInit(): Promise<void> {
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

async function cmdGlobalInit(): Promise<void> {
  const home = globalHome();
  await ensureDir(home);
  const manifestPath = globalManifestPath();

  if (await pathExists(manifestPath)) {
    console.error(`Error: ${manifestPath} already exists`);
    process.exit(1);
  }

  await writeTextFile(manifestPath, INIT_GLOBAL_MANIFEST);
  console.log(`Created ${manifestPath}`);
}

async function cmdSet(key: string, global: boolean): Promise<void> {
  const scope: Scope = global ? "global" : "project";
  const projectRoot = global ? null : await requireProjectRoot();
  await ensureVarInManifest(key, scope, projectRoot);

  const value = await readStdinSecret();
  if (!value) {
    console.error("Error: empty value (pipe secret via stdin)");
    process.exit(1);
  }

  const secretsPath = global ? globalSecretsPath() : projectSecretsPath(projectRoot!);
  const vault = createVaultStore(secretsPath);
  await vault.set(key, value);
  console.log(`Set ${key} (${scope})`);
}

async function cmdGlobalSet(key: string): Promise<void> {
  await cmdSet(key, true);
}

async function cmdAdopt(key: string, global: boolean): Promise<void> {
  const value = process.env[key];
  if (!value) {
    console.error(`Error: ${key} not set in environment`);
    process.exit(1);
  }

  const scope: Scope = global ? "global" : "project";
  const projectRoot = global ? null : await requireProjectRoot();
  await ensureVarInManifest(key, scope, projectRoot);

  const secretsPath = global ? globalSecretsPath() : projectSecretsPath(projectRoot!);
  const vault = createVaultStore(secretsPath);
  await vault.set(key, value);
  console.log(`Adopted ${key} (${scope})`);
}

async function cmdUnset(key: string, global: boolean): Promise<void> {
  const secretsPath = global
    ? globalSecretsPath()
    : projectSecretsPath(await requireProjectRoot());
  const vault = createVaultStore(secretsPath);
  const removed = await vault.unset(key);
  if (!removed) {
    console.error(`Error: ${key} not in vault`);
    process.exit(1);
  }
  console.log(`Unset ${key}`);
}

async function cmdList(json: boolean, globalOnly: boolean): Promise<void> {
  const projectRoot = globalOnly ? null : await findProjectRoot();
  const ctx = await loadResolveContext(projectRoot);
  const vars = await resolveAll(ctx, { globalOnly, includeSecrets: false });

  if (json) {
    console.log(JSON.stringify({ vars }, null, 2));
    return;
  }

  for (const v of vars) {
    const status = v.status === "set" ? "set" : "missing";
    console.log(`${v.key}\t${status}\t${v.scope}\t${v.visibility}`);
  }
}

async function cmdDoctor(json: boolean, globalOnly: boolean, bundleFilter?: string): Promise<void> {
  const result = globalOnly
    ? await runGlobalDoctor(bundleFilter)
    : await runDoctor(await findProjectRoot(), bundleFilter);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printDoctor(result);
  }

  if (!result.ready) process.exit(1);
}

async function cmdCatalogList(json: boolean): Promise<void> {
  printCatalogList(json);
}

async function cmdValidate(): Promise<void> {
  const projectRoot = await findProjectRoot();
  const reports = await runValidate(projectRoot);
  formatValidateReports(reports);

  if (!reports.every((r) => r.ok)) {
    process.exit(1);
  }
}

async function cmdSchema(_json: boolean): Promise<void> {
  const projectRoot = await findProjectRoot();
  const ctx = await loadResolveContext(projectRoot);
  const schema = exportSchema(ctx);
  console.log(JSON.stringify(schema, null, 2));
}

async function cmdPrint(key: string, json: boolean): Promise<void> {
  const projectRoot = await findProjectRoot();
  const ctx = await loadResolveContext(projectRoot);

  const projectDef = ctx.projectManifest?.vars.get(key);
  const globalDef = ctx.globalManifest?.vars.get(key);
  if (!projectDef && !globalDef) {
    console.error(`Error: unknown key ${key}`);
    process.exit(1);
  }

  const isProjectKey = ctx.projectManifest?.vars.has(key) ?? false;
  const def: VarDefinition = {
    key,
    visibility: projectDef?.visibility ?? globalDef!.visibility,
    scope: projectDef?.scope ?? globalDef?.scope ?? (isProjectKey ? "project" : "global"),
    value: projectDef?.value ?? globalDef?.value,
    ask: projectDef?.ask ?? globalDef?.ask,
    docs: projectDef?.docs ?? globalDef?.docs,
    derive: projectDef?.derive ?? globalDef?.derive,
  };

  const resolved = await resolveVar(ctx, def, { includeSecrets: true });

  if (resolved.visibility === "secret") {
    console.error(`Error: ${key} is a secret — use ap run instead`);
    process.exit(1);
  }

  if (resolved.status === "missing") {
    console.error(`Error: ${key} is missing`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify({ key, value: resolved.value }, null, 2));
  } else {
    console.log(resolved.value);
  }
}

async function cmdRun(cmd: string[], bundleFilter?: string): Promise<void> {
  if (cmd.length === 0) {
    console.error("Error: no command specified (use: ap run -- <cmd>)");
    process.exit(1);
  }

  const projectRoot = await requireProjectRoot();
  const code = await runCommand(projectRoot, cmd, { bundleFilter });
  process.exit(code);
}

async function cmdPaths(json: boolean): Promise<void> {
  printPaths(await getPathsInfo(), json);
}

function parseEditTarget(raw?: string): EditTarget {
  if (!raw || raw === "secrets") return "secrets";
  if (raw === "manifest") return "manifest";
  if (raw === "ap" || raw === "ap.toml" || raw === "config") return "ap";
  throw new Error(`Unknown edit target "${raw}" (use: secrets, manifest, ap)`);
}

async function cmdEdit(rest: string[]): Promise<void> {
  const global = rest.includes("--global");
  const positional = rest.filter((a) => !a.startsWith("--"));
  const raw = positional[0];
  const target = parseEditTarget(raw ?? "secrets");

  let useGlobal: boolean;
  if (target === "ap") {
    useGlobal = false;
  } else if (global) {
    useGlobal = true;
  } else if (raw === undefined) {
    useGlobal = true;
  } else if (target === "manifest") {
    useGlobal = true;
  } else {
    useGlobal = false;
  }

  const info = await getPathsInfo();
  const path = resolveEditPath(target, useGlobal, info);

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
        await cmdCatalogList(json);
        return;
      }
      console.error("Unknown catalog command. Use: ap catalog list [--json]");
      process.exit(1);
    }

    if (positional[0] === "global") {
      const sub = positional[1];
      const rest = stripFlags(positional.slice(2));

      switch (sub) {
        case "init":
          await cmdGlobalInit();
          break;
        case "set": {
          const key = rest[0];
          if (!key) {
            console.error("Error: KEY required");
            process.exit(1);
          }
          await cmdGlobalSet(key);
          break;
        }
        case "list":
          await cmdList(json, true);
          break;
        case "doctor":
          await cmdDoctor(json, true, parseBundleFilter(positional));
          break;
        default:
          console.error(`Unknown global command: ${sub ?? "(none)"}`);
          usage();
          process.exit(1);
      }
      return;
    }

    if (positional[0] === "skill") {
      const sub = positional[1];
      if (sub === "install") {
        await cmdSkillInstall(positional.includes("--project"));
        return;
      }
      console.error("Unknown skill command. Use: ap skill install [--project]");
      process.exit(1);
    }

    const cmd = positional[0];
    const rest = stripFlags(positional.slice(1));

    switch (cmd) {
      case "init":
        await cmdInit();
        break;
      case "set": {
        const key = rest.find((a) => !a.startsWith("--"));
        const global = rest.includes("--global");
        if (!key) {
          console.error("Error: KEY required");
          process.exit(1);
        }
        await cmdSet(key, global);
        break;
      }
      case "adopt": {
        const key = rest.find((a) => !a.startsWith("--"));
        const global = rest.includes("--global");
        if (!key) {
          console.error("Error: KEY required");
          process.exit(1);
        }
        await cmdAdopt(key, global);
        break;
      }
      case "unset": {
        const key = rest.find((a) => !a.startsWith("--"));
        const global = rest.includes("--global");
        if (!key) {
          console.error("Error: KEY required");
          process.exit(1);
        }
        await cmdUnset(key, global);
        break;
      }
      case "list":
        await cmdList(json, false);
        break;
      case "doctor":
        await cmdDoctor(json, false, parseBundleFilter(args));
        break;
      case "validate":
        await cmdValidate();
        break;
      case "schema":
        await cmdSchema(json);
        break;
      case "print": {
        const key = rest.find((a) => !a.startsWith("--"));
        if (!key) {
          console.error("Error: KEY required");
          process.exit(1);
        }
        await cmdPrint(key, json);
        break;
      }
      case "paths":
        await cmdPaths(json);
        break;
      case "edit":
        await cmdEdit(rest);
        break;
      case "run": {
        const dashIndex = args.indexOf("--");
        const cmdArgs = dashIndex >= 0 ? args.slice(dashIndex + 1) : rest;
        await cmdRun(cmdArgs, parseBundleFilter(args));
        break;
      }
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
