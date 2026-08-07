import { chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { loadEncryptionConfig } from "./encryption/config.ts";
import { ensureEncryptedSecretsFile, isEncryptionReady, sopsEdit } from "./encryption/sops.ts";
import {
  findProjectRoot,
  globalHome,
  globalManifestPath,
  projectManifestPath,
  projectSecretsPath,
} from "./paths.ts";
import { ensureDir, pathExists, writeSecretFile, writeTextFile } from "./fs-helpers.ts";
import { spawnAsync } from "./spawn.ts";

export interface ApPathsInfo {
  global_home: string;
  global_manifest: string;
  project: string | null;
  project_manifest: string | null;
  project_secrets: string | null;
}

export async function getPathsInfo(): Promise<ApPathsInfo> {
  const project = await findProjectRoot();
  return {
    global_home: globalHome(),
    global_manifest: globalManifestPath(),
    project,
    project_manifest: project ? projectManifestPath(project) : null,
    project_secrets: project ? projectSecretsPath(project) : null,
  };
}

export type EditTarget = "secrets" | "manifest" | "toml";

/** Canonicalize user-facing edit targets (global/project aliases). */
export function parseEditTarget(raw: string): EditTarget {
  if (raw === "secrets") return "secrets";
  if (raw === "manifest" || raw === "global") return "manifest";
  if (raw === "toml" || raw === "project") return "toml";
  throw new Error(`Unknown edit target "${raw}" (use: secrets, global, project)`);
}

export function resolveEditScope(
  target: EditTarget,
  globalFlag: boolean,
  hasProject: boolean,
): { useGlobal: boolean; error?: string } {
  if (target === "toml" && globalFlag) {
    return { useGlobal: false, error: "project is always project-scoped (omit -g/--global)" };
  }
  if (target === "secrets" && globalFlag) {
    return {
      useGlobal: false,
      error: "secrets is project-only (.ap/secrets.json); use `ap edit global` for global values",
    };
  }
  if (target === "manifest") {
    return { useGlobal: true };
  }
  if (target === "toml") {
    if (!hasProject) {
      return { useGlobal: false, error: "no ap.toml found. Run `ap init` first." };
    }
    return { useGlobal: false };
  }
  // secrets — project vault only
  if (!hasProject) {
    return {
      useGlobal: false,
      error: "no ap.toml found. Run `ap init` first. Global secrets live in `ap edit global`.",
    };
  }
  return { useGlobal: false };
}

export function resolveEditPath(
  target: EditTarget,
  _global: boolean,
  info: ApPathsInfo,
): string {
  switch (target) {
    case "secrets":
      if (!info.project_secrets) {
        throw new Error("No project ap.toml found. Run `ap init` first.");
      }
      return info.project_secrets;
    case "manifest":
      return info.global_manifest;
    case "toml":
      if (!info.project_manifest) {
        throw new Error("No project ap.toml found. Run `ap init` first.");
      }
      return info.project_manifest;
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

async function seedFile(path: string, target: EditTarget): Promise<void> {
  if (await pathExists(path)) return;

  await ensureDir(dirname(path));

  if (target === "secrets") {
    await writeSecretFile(path, "{}\n");
    return;
  }

  if (target === "manifest") {
    await writeTextFile(path, 'version = 1\nscope = "global"\n\n');
    return;
  }

  await writeTextFile(path, 'version = 1\nscope = "project"\n\nbundles = []\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** GUI editors return immediately; terminal editors block until quit. */
export function isDetachedEditor(editor: string | undefined): boolean {
  if (!editor) return false;
  const base = editor.trim().split(/\s+/)[0] ?? editor;
  const name = base.split("/").pop() ?? base;
  return /^(code|cursor|windsurf|open|subl|bbedit|mate)$/i.test(name);
}

function buildEditorShellCommand(path: string): string {
  const editor = process.env.VISUAL || process.env.EDITOR;
  const quoted = shellQuote(path);

  if (!editor) return `nano ${quoted}`;

  const cmd = isDetachedEditor(editor) ? editor.replace(/\s+--wait\b/, "") : editor;
  return `${cmd} ${quoted}`;
}

function shellInvokeArgs(command: string): [string, string[]] {
  const shell = process.env.SHELL || "/bin/zsh";
  const name = shell.split("/").pop() ?? "zsh";

  if (name === "fish") return [shell, ["-lc", command]];
  return [shell, ["-lic", command]];
}

export async function openInEditor(
  path: string,
  target: EditTarget,
  options?: { projectRoot?: string | null },
): Promise<number> {
  const encryptedSecrets =
    target === "secrets" &&
    options?.projectRoot &&
    (await isEncryptionReady(options.projectRoot));

  if (!encryptedSecrets) {
    await seedFile(path, target);
  }

  if (encryptedSecrets) {
    const config = await loadEncryptionConfig(options.projectRoot!);
    if (!config) {
      throw new Error("Encryption config missing — run: ap setup");
    }
    if (!(await pathExists(path))) {
      await ensureEncryptedSecretsFile(path, config, options.projectRoot!);
    }
    return await sopsEdit(path, config, options.projectRoot!);
  }

  if (target === "secrets" && process.platform !== "win32" && (await pathExists(path))) {
    await chmod(path, 0o600);
  }

  const editor = process.env.VISUAL || process.env.EDITOR;
  const detached = isDetachedEditor(editor);
  const [shell, args] = shellInvokeArgs(buildEditorShellCommand(path));

  if (detached) {
    await spawnAsync(shell, args, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    return 0;
  }

  const { code } = await spawnAsync(shell, args, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (code === 0 && target === "secrets" && process.platform !== "win32") {
    await chmod(path, 0o600);
  }
  return code;
}
