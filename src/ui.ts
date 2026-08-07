import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import {
  catalogBundleDefinition,
  catalogVarToDefinition,
  getCatalogBundle,
} from "./catalog/bundles.ts";
import { ensureDir, pathExists, readTextFile, writeTextFile } from "./fs-helpers.ts";
import { parseManifestContent, defaultScopeForPath } from "./manifest.ts";
import {
  findProjectRoot,
  globalManifestPath,
  projectManifestPath,
} from "./paths.ts";
import { spawnAsync } from "./spawn.ts";
import {
  manifestToUiModel,
  parseContentToUiModel,
  serializeUiModel,
  type UiManifestModel,
  type UiMode,
  type UiVar,
  uiModelToManifest,
} from "./ui-model.ts";
import { buildUiHtml } from "./ui-page.ts";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4789;

export type UiTarget = "toml" | "manifest";

export interface UiResolveResult {
  target: UiTarget;
  mode: UiMode;
  path: string;
  label: string;
  error?: string;
}

export async function resolveUiTarget(globalFlag: boolean): Promise<UiResolveResult> {
  if (globalFlag) {
    return {
      target: "manifest",
      mode: "global",
      path: globalManifestPath(),
      label: "global manifest.toml",
    };
  }

  const root = await findProjectRoot();
  if (!root) {
    return {
      target: "toml",
      mode: "project",
      path: "",
      label: "ap.toml",
      error: "no ap.toml found. Run `ap init` first (or use --global).",
    };
  }

  return {
    target: "toml",
    mode: "project",
    path: projectManifestPath(root),
    label: "project ap.toml",
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

export { buildUiHtml };

export async function loadUiContent(path: string): Promise<string> {
  if (!(await pathExists(path))) {
    return "version = 1\n\n";
  }
  return await readTextFile(path);
}

export async function saveUiContent(path: string, content: string): Promise<string> {
  parseManifestContent(content, path, { defaultScope: defaultScopeForPath(path) });
  const normalized = content.endsWith("\n") ? content : content + "\n";
  await ensureDir(dirname(path));
  await writeTextFile(path, normalized);
  return normalized;
}

export async function saveUiModel(path: string, model: UiManifestModel): Promise<{
  content: string;
  model: UiManifestModel;
}> {
  const content = serializeUiModel(model);
  await saveUiContent(path, content);
  return { content, model: parseContentToUiModel(content, model.mode) };
}

function catalogPayload(name: string): { bundle: unknown; vars: UiVar[] } | { error: string } {
  const entry = getCatalogBundle(name);
  const bundle = catalogBundleDefinition(name);
  if (!entry || !bundle) return { error: `unknown catalog bundle "${name}"` };

  const vars: UiVar[] = Object.entries(entry.vars).map(([key, def]) => {
    const v = catalogVarToDefinition(key, def);
    return {
      key: v.key,
      visibility: v.visibility,
      ...(v.ask ? { ask: v.ask } : {}),
      ...(v.docs ? { docs: v.docs } : {}),
      ...(v.derive ? { derive: v.derive } : {}),
    };
  });

  return {
    bundle: {
      name: bundle.name,
      ask: bundle.ask,
      docs: bundle.docs,
      prompt: bundle.prompt,
      vars: [...bundle.vars],
    },
    vars,
  };
}

async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  if (platform === "darwin") {
    await spawnAsync("open", [url], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true });
    return;
  }
  if (platform === "win32") {
    await spawnAsync("cmd", ["/c", "start", "", url], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    return;
  }
  await spawnAsync("xdg-open", [url], { stdin: "ignore", stdout: "ignore", stderr: "ignore", detached: true });
}

export interface StartUiOptions {
  global: boolean;
  port?: number;
  open?: boolean;
}

export async function startUi(options: StartUiOptions): Promise<void> {
  const resolved = await resolveUiTarget(options.global);
  if (resolved.error) {
    throw new Error(resolved.error);
  }

  const filePath = resolved.path;
  const mode = resolved.mode;
  const port = options.port ?? DEFAULT_PORT;
  const open = options.open !== false;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${HOST}:${port}`);

      if (req.method === "GET" && url.pathname === "/") {
        const content = await loadUiContent(filePath);
        const model = parseContentToUiModel(content, mode);
        sendHtml(
          res,
          buildUiHtml({
            label: resolved.label,
            path: filePath,
            mode,
            model,
            content,
          }),
        );
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/content") {
        const content = await loadUiContent(filePath);
        sendJson(res, 200, {
          path: filePath,
          content,
          model: parseContentToUiModel(content, mode),
        });
        return;
      }

      if (req.method === "GET" && url.pathname.startsWith("/api/catalog/")) {
        const name = decodeURIComponent(url.pathname.slice("/api/catalog/".length));
        const payload = catalogPayload(name);
        if ("error" in payload) {
          sendJson(res, 404, payload);
          return;
        }
        sendJson(res, 200, payload);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/preview") {
        const raw = await readBody(req);
        try {
          const parsed = JSON.parse(raw) as { model?: UiManifestModel };
          if (!parsed.model) {
            sendJson(res, 400, { error: "model required" });
            return;
          }
          parsed.model.mode = mode;
          const content = serializeUiModel(parsed.model);
          sendJson(res, 200, { content });
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/save") {
        const raw = await readBody(req);
        let payload: { content?: unknown; model?: UiManifestModel };
        try {
          payload = JSON.parse(raw) as { content?: unknown; model?: UiManifestModel };
        } catch {
          sendJson(res, 400, { error: "invalid JSON body" });
          return;
        }

        try {
          if (typeof payload.content === "string") {
            const content = await saveUiContent(filePath, payload.content);
            sendJson(res, 200, {
              message: `Saved ${resolved.label}`,
              content,
              model: parseContentToUiModel(content, mode),
            });
            return;
          }

          if (payload.model && typeof payload.model === "object") {
            payload.model.mode = mode;
            // Validate conversion early for clearer errors
            uiModelToManifest(payload.model);
            const saved = await saveUiModel(filePath, payload.model);
            sendJson(res, 200, {
              message: `Saved ${resolved.label}`,
              content: saved.content,
              model: saved.model,
            });
            return;
          }

          sendJson(res, 400, { error: "content or model required" });
        } catch (err) {
          sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve());
  });

  const url = `http://${HOST}:${port}/`;
  console.log(`ap ui — editing ${resolved.label}`);
  console.log(`  ${filePath}`);
  console.log(`  ${url}`);
  console.log("Ctrl+C to stop");

  if (open) {
    try {
      await openBrowser(url);
    } catch {
      // browser open is best-effort
    }
  }

  await new Promise<void>((resolve) => {
    const stop = () => {
      server.close(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export { manifestToUiModel, parseContentToUiModel, serializeUiModel };
