import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseManifestContent } from "../src/manifest.ts";
import { resolveBundles } from "../src/bundles.ts";
import { resolveVar, resolveAll, resolveForRun, type ResolveContext } from "../src/resolve.ts";
import { runDoctor } from "../src/doctor.ts";
import type { VarDefinition } from "../src/types.ts";

function emptyCtx(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    projectRoot: "/tmp/proj",
    globalManifest: null,
    projectManifest: null,
    projectSecrets: {},
    ...overrides,
  };
}

describe("parseManifestContent", () => {
  test("parses vars with file-level scope and visibility", () => {
    const content = `
version = 1
scope = "global"

[var.NC_API_USER]
visibility = "public"
value = "user123"

[var.NC_API_KEY]
visibility = "secret"
ask = "paste key"

[var.NC_CLIENT_IP]
visibility = "public"
derive = "public-ipv4"
`;

    const manifest = parseManifestContent(content, "test.toml");
    expect(manifest.version).toBe(1);
    expect(manifest.scope).toBe("global");
    expect(manifest.vars.get("NC_API_USER")?.visibility).toBe("public");
    expect(manifest.vars.get("NC_API_KEY")?.scope).toBe("global");
    expect(manifest.vars.get("NC_CLIENT_IP")?.derive).toBe("public-ipv4");
  });

  test("parses storage = secrets.json", () => {
    const manifest = parseManifestContent(
      `version = 1
scope = "project"

[var.DEPLOY_TOKEN]
visibility = "secret"
storage = "secrets.json"
ask = "deploy token"
`,
      "ap.toml",
    );
    expect(manifest.vars.get("DEPLOY_TOKEN")?.storage).toBe("secrets.json");
  });

  test("rejects storage on global scope", () => {
    expect(() =>
      parseManifestContent(
        `version = 1
scope = "global"

[var.FOO]
visibility = "secret"
storage = "secrets.json"
`,
        "bad.toml",
      ),
    ).toThrow(/requires scope = "project"/);
  });

  test("rejects value and storage together", () => {
    expect(() =>
      parseManifestContent(
        `version = 1
scope = "project"

[var.FOO]
visibility = "secret"
storage = "secrets.json"
value = "nope"
`,
        "bad.toml",
      ),
    ).toThrow(/value or storage/);
  });

  test("rejects per-var scope", () => {
    expect(() =>
      parseManifestContent(
        `version = 1
scope = "global"

[var.FOO]
visibility = "secret"
scope = "project"
`,
        "bad.toml",
      ),
    ).toThrow(/scope belongs at the top/);
  });

  test("parses bundles and activeBundles", () => {
    const content = `
version = 1
scope = "project"
bundles = ["namecheap"]

[bundle.namecheap]
ask = "Set up Namecheap"
vars = ["NC_API_USER", "NC_API_KEY"]
`;

    const manifest = parseManifestContent(content, "test.toml");
    expect(manifest.activeBundles).toEqual(["namecheap"]);
    expect(manifest.scope).toBe("project");
    expect(manifest.bundles.get("namecheap")?.vars).toEqual(["NC_API_USER", "NC_API_KEY"]);
  });

  test("rejects invalid version", () => {
    expect(() => parseManifestContent("version = 2", "bad.toml")).toThrow("unsupported version");
  });

  test("rejects derived visibility", () => {
    expect(() =>
      parseManifestContent(
        `version = 1\nscope = "global"\n[var.NC_CLIENT_IP]\nvisibility = "derived"\nderive = "public-ipv4"\n`,
        "bad.toml",
      ),
    ).toThrow(/invalid visibility "derived"/);
  });
});

describe("resolveVar", () => {
  test("uses project vault only when storage = secrets.json", async () => {
    const def: VarDefinition = {
      key: "DEPLOY_TOKEN",
      visibility: "secret",
      scope: "project",
      storage: "secrets.json",
    };

    const resolved = await resolveVar(
      emptyCtx({ projectSecrets: { DEPLOY_TOKEN: "tok123" } }),
      def,
      { includeSecrets: true },
    );
    expect(resolved.status).toBe("set");
    expect(resolved.storage).toBe("secrets.json");
    expect(resolved.value).toBe("tok123");
  });

  test("ignores project vault without storage declaration", async () => {
    const def: VarDefinition = {
      key: "DEPLOY_TOKEN",
      visibility: "secret",
      scope: "project",
    };

    const resolved = await resolveVar(
      emptyCtx({ projectSecrets: { DEPLOY_TOKEN: "tok123" } }),
      def,
      { includeSecrets: true },
    );
    expect(resolved.status).toBe("missing");
    expect(resolved.storage).toBe("inline");
  });

  test("masks secrets in show mode", async () => {
    const def: VarDefinition = {
      key: "NC_API_KEY",
      visibility: "secret",
      scope: "global",
      value: "secret-value",
    };

    const resolved = await resolveVar(emptyCtx(), def);
    expect(resolved.status).toBe("set");
    expect(resolved.masked).toBe(true);
    expect(resolved.value).toBeUndefined();
  });

  test("surfaces full public value with surfacePublic", async () => {
    const def: VarDefinition = {
      key: "NC_API_USER",
      visibility: "public",
      scope: "global",
      value: "UsysD3nN39n4Mi",
    };

    const resolved = await resolveVar(emptyCtx(), def, { surfacePublic: true });
    expect(resolved.value).toBe("UsysD3nN39n4Mi");
  });

  test("includes set_with when missing", async () => {
    const def: VarDefinition = {
      key: "NC_API_KEY",
      visibility: "secret",
      scope: "global",
      ask: "paste key",
    };

    const resolved = await resolveVar(emptyCtx(), def);
    expect(resolved.status).toBe("missing");
    expect(resolved.set_with).toBe("ap set NC_API_KEY");
  });

  test("reads inline secret from manifest", async () => {
    const def: VarDefinition = {
      key: "CF_GLOBAL_API_KEY",
      visibility: "secret",
      scope: "global",
      value: "inline-key",
    };

    const resolved = await resolveVar(emptyCtx(), def, { includeSecrets: true });
    expect(resolved.status).toBe("set");
    expect(resolved.storage).toBe("inline");
    expect(resolved.value).toBe("inline-key");
  });
});

describe("bundles", () => {
  test("show groups by bundle and surfaces public vars", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-bundle-"));
    const globalDir = join(dir, "global");
    const prevHome = process.env.AP_GLOBAL_HOME;

    try {
      process.env.AP_GLOBAL_HOME = globalDir;
      await mkdir(globalDir, { recursive: true });
      await mkdir(join(dir, ".ap"), { recursive: true });

      await writeFile(join(dir, "ap.toml"), `version = 1\nscope = "project"\nbundles = ["namecheap"]\n`);
      await writeFile(join(globalDir, "manifest.toml"), `version = 1\nscope = "global"

[bundle.namecheap]
ask = "Namecheap setup"
vars = ["NC_API_USER", "NC_API_KEY"]

[var.NC_API_USER]
visibility = "public"
value = "testuser"

[var.NC_API_KEY]
visibility = "secret"
ask = "paste key"
value = "key123"
`);

      const result = await runDoctor(dir);
      expect(result.bundles.namecheap.ready).toBe(true);
      expect(result.bundles.namecheap.surfaced).toEqual([{ key: "NC_API_USER", value: "testuser" }]);
      expect(result.bundles.namecheap.secrets_set).toEqual(["NC_API_KEY"]);
    } finally {
      if (prevHome === undefined) delete process.env.AP_GLOBAL_HOME;
      else process.env.AP_GLOBAL_HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("falls back to global bundles when no project ap.toml", async () => {
    const ctx = emptyCtx({
      projectRoot: null,
      globalManifest: parseManifestContent(`version = 1
scope = "global"
[bundle.cloudflare]
vars = ["CF_GLOBAL_API_KEY"]
`, "g"),
    });

    const vars = await resolveAll(ctx);
    expect(vars.map((v) => v.key)).toEqual(["CF_GLOBAL_API_KEY"]);
  });

  test("resolveBundles reports missing secrets", async () => {
    const ctx = emptyCtx({
      globalManifest: parseManifestContent(`version = 1
scope = "global"
[bundle.namecheap]
vars = ["NC_API_KEY"]
`, "g"),
      projectManifest: parseManifestContent("version = 1\nscope = \"project\"\nbundles = [\"namecheap\"]\n", "p"),
    });

    const vars = await resolveAll(ctx, { surfacePublic: true });
    const bundles = await resolveBundles(ctx, vars);
    expect(bundles.namecheap.ready).toBe(false);
    expect(bundles.namecheap.missing[0]?.key).toBe("NC_API_KEY");
  });

  test("treats vars outside active bundles as secrets", async () => {
    const ctx = emptyCtx({
      globalManifest: parseManifestContent(`version = 1
scope = "global"
[bundle.namecheap]
vars = ["NC_API_USER"]

[var.NC_API_USER]
visibility = "public"
value = "testuser"

[var.STANDALONE_VALUE]
visibility = "public"
value = "do-not-surface"
`, "g"),
      projectManifest: parseManifestContent("version = 1\nscope = \"project\"\nbundles = [\"namecheap\"]\n", "p"),
    });

    const vars = await resolveAll(ctx, { surfacePublic: true });
    const bundled = vars.find((v) => v.key === "NC_API_USER")!;
    const standalone = vars.find((v) => v.key === "STANDALONE_VALUE")!;

    expect(bundled.visibility).toBe("public");
    expect(bundled.value).toBe("testuser");
    expect(standalone.visibility).toBe("secret");
    expect(standalone.masked).toBe(true);
    expect(standalone.value).toBeUndefined();
  });

  test("still injects vars outside active bundles at run time", async () => {
    const ctx = emptyCtx({
      globalManifest: parseManifestContent(`version = 1
scope = "global"
[bundle.namecheap]
vars = ["NC_API_USER"]

[var.NC_API_USER]
visibility = "public"
value = "testuser"

[var.STANDALONE_VALUE]
visibility = "public"
value = "runtime-only"
`, "g"),
      projectManifest: parseManifestContent("version = 1\nscope = \"project\"\nbundles = [\"namecheap\"]\n", "p"),
    });

    const env = await resolveForRun(ctx);
    expect(env.NC_API_USER).toBe("testuser");
    expect(env.STANDALONE_VALUE).toBe("runtime-only");
  });

  test("catalog fallback resolves project bundles without global [bundle.*]", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-catalog-"));
    const globalDir = join(dir, "global");
    const prevHome = process.env.AP_GLOBAL_HOME;

    try {
      process.env.AP_GLOBAL_HOME = globalDir;
      await mkdir(globalDir, { recursive: true });
      await mkdir(join(dir, ".ap"), { recursive: true });

      await writeFile(join(dir, "ap.toml"), `version = 1\nscope = "project"\nbundles = ["cloudflare"]\n`);
      await writeFile(join(globalDir, "manifest.toml"), `version = 1
scope = "global"

[var.CF_GLOBAL_EMAIL]
visibility = "public"
value = "user@example.com"

[var.CF_GLOBAL_API_KEY]
visibility = "secret"
value = "key123"
`);

      const result = await runDoctor(dir);
      expect(result.bundles.cloudflare.ready).toBe(true);
      expect(result.bundles.cloudflare.surfaced).toEqual([
        { key: "CF_GLOBAL_EMAIL", value: "user@example.com" },
      ]);
    } finally {
      if (prevHome === undefined) delete process.env.AP_GLOBAL_HOME;
      else process.env.AP_GLOBAL_HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("project vault works with explicit storage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-vault-"));
    const globalDir = join(dir, "global");
    const prevHome = process.env.AP_GLOBAL_HOME;

    try {
      process.env.AP_GLOBAL_HOME = globalDir;
      await mkdir(globalDir, { recursive: true });
      await mkdir(join(dir, ".ap"), { recursive: true });

      await writeFile(
        join(dir, "ap.toml"),
        `version = 1
scope = "project"
bundles = []

[var.DEPLOY_TOKEN]
visibility = "secret"
storage = "secrets.json"
`,
      );
      await writeFile(join(globalDir, "manifest.toml"), `version = 1\nscope = "global"\n`);
      await writeFile(
        join(dir, ".ap", "secrets.json"),
        JSON.stringify({ DEPLOY_TOKEN: "deploy-secret" }) + "\n",
      );

      const result = await runDoctor(dir);
      const token = result.vars?.find((v) => v.key === "DEPLOY_TOKEN");
      expect(token?.status).toBe("set");
      expect(token?.storage).toBe("secrets.json");
      expect(token?.masked).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.AP_GLOBAL_HOME;
      else process.env.AP_GLOBAL_HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("missing standalone vars do not brick bundled ap run", async () => {
    const ctx = emptyCtx({
      globalManifest: parseManifestContent(`version = 1
scope = "global"
[bundle.namecheap]
vars = ["NC_API_USER"]

[var.NC_API_USER]
visibility = "public"
value = "testuser"

[var.ORPHAN]
visibility = "secret"
`, "g"),
      projectManifest: parseManifestContent("version = 1\nscope = \"project\"\nbundles = [\"namecheap\"]\n", "p"),
    });

    const env = await resolveForRun(ctx, { bundleFilter: "namecheap" });
    expect(env.NC_API_USER).toBe("testuser");
    expect(env.ORPHAN).toBeUndefined();
  });

  test("unknown bundle filter errors on run", async () => {
    const ctx = emptyCtx({
      globalManifest: parseManifestContent("version = 1\nscope = \"global\"\n", "g"),
      projectManifest: parseManifestContent("version = 1\nscope = \"project\"\nbundles = []\n", "p"),
    });

    try {
      await resolveForRun(ctx, { bundleFilter: "nope" });
      throw new Error("expected resolveForRun to throw");
    } catch (err) {
      expect(err instanceof Error && err.message.includes("Unknown bundle")).toBe(true);
    }
  });
});
