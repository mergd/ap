import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureDir, isNotFound, readTextFile, writeTextFile } from "./fs-helpers.ts";
import { globalHome } from "./paths.ts";

const PACKAGE_NAME = "@mergd/ap";
const REGISTRY_URL = "https://registry.npmjs.org/@mergd%2Fap/latest";
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 1_500;

interface UpdateCache {
  checked_at: number;
  latest?: string;
}

export interface UpdateNotice {
  current: string;
  latest: string;
  command: string;
}

interface UpdateCheckOptions {
  currentVersion?: string;
  cachePath?: string;
  now?: number;
  intervalMs?: number;
  fetchLatest?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerVersion(latest: string, current: string): boolean {
  const next = parseVersion(latest);
  const installed = parseVersion(current);
  if (!next || !installed) return false;

  for (let i = 0; i < 3; i++) {
    if (next[i] !== installed[i]) return next[i] > installed[i];
  }
  return false;
}

async function readCurrentVersion(): Promise<string> {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string") throw new Error("package version missing");
  return pkg.version;
}

async function readCache(path: string): Promise<UpdateCache | null> {
  try {
    const parsed = JSON.parse(await readTextFile(path)) as Partial<UpdateCache>;
    if (typeof parsed.checked_at !== "number") return null;
    return {
      checked_at: parsed.checked_at,
      ...(typeof parsed.latest === "string" ? { latest: parsed.latest } : {}),
    };
  } catch (err) {
    if (isNotFound(err) || err instanceof SyntaxError) return null;
    throw err;
  }
}

async function writeCache(path: string, cache: UpdateCache): Promise<void> {
  await ensureDir(dirname(path));
  await writeTextFile(path, `${JSON.stringify(cache, null, 2)}\n`);
}

async function fetchLatestVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(REGISTRY_URL, {
      headers: { accept: "application/json", "user-agent": `${PACKAGE_NAME} update-check` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`npm registry returned ${response.status}`);
    const body = await response.json() as { version?: unknown };
    if (typeof body.version !== "string" || !parseVersion(body.version)) {
      throw new Error("npm registry returned an invalid version");
    }
    return body.version;
  } finally {
    clearTimeout(timeout);
  }
}

function disabled(env: NodeJS.ProcessEnv): boolean {
  const value = env.AP_NO_UPDATE_CHECK?.toLowerCase();
  return Boolean(env.CI) || value === "1" || value === "true";
}

export async function checkForUpdate(
  options: UpdateCheckOptions = {},
): Promise<UpdateNotice | null> {
  const env = options.env ?? process.env;
  if (disabled(env)) return null;

  const now = options.now ?? Date.now();
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const cachePath = options.cachePath ?? join(globalHome(), "update-check.json");

  try {
    const cache = await readCache(cachePath);
    if (cache && now - cache.checked_at < intervalMs) return null;

    const current = options.currentVersion ?? await readCurrentVersion();
    let latest = cache?.latest;
    try {
      latest = await (options.fetchLatest ?? fetchLatestVersion)();
    } finally {
      await writeCache(cachePath, {
        checked_at: now,
        ...(latest ? { latest } : {}),
      });
    }

    if (!isNewerVersion(latest, current)) return null;
    return {
      current,
      latest,
      command: `npm install -g ${PACKAGE_NAME}@latest`,
    };
  } catch {
    return null;
  }
}

export function formatUpdateNotice(notice: UpdateNotice): string {
  return `Update available: ${notice.current} → ${notice.latest} · ${notice.command}`;
}
