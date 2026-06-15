import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseManifestContent } from "../src/manifest.ts";
import { resolveBundles } from "../src/bundles.ts";
import { resolveVar, loadResolveContext, resolveAll, type ResolveContext } from "../src/resolve.ts";
import { runDoctor } from "../src/doctor.ts";
import type { VarDefinition } from "../src/types.ts";

describe("parseManifestContent", () => {
  test("parses vars with scope and visibility", () => {
    const content = `
version = 1

[var.NC_API_USER]
visibility = "public"
value = "user123"

[var.NC_API_KEY]
scope = "global"
visibility = "secret"
ask = "paste key"

[var.NC_CLIENT_IP]
scope = "global"
visibility = "public"
derive = "public-ipv4"
`;

    const manifest = parseManifestContent(content, "test.toml");
    expect(manifest.version).toBe(1);
    expect(manifest.vars.get("NC_API_USER")?.visibility).toBe("public");
    expect(manifest.vars.get("NC_API_KEY")?.scope).toBe("global");
    expect(manifest.vars.get("NC_CLIENT_IP")?.derive).toBe("public-ipv4");
  });

  test("parses bundles and activeBundles", () => {
    const content = `
version = 1
bundles = ["namecheap"]

[bundle.namecheap]
ask = "Set up Namecheap"
vars = ["NC_API_USER", "NC_API_KEY"]
`;

    const manifest = parseManifestContent(content, "test.toml");
    expect(manifest.activeBundles).toEqual(["namecheap"]);
    expect(manifest.bundles.get("namecheap")?.vars).toEqual(["NC_API_USER", "NC_API_KEY"]);
  });

  test("rejects invalid version", () => {
    expect(() => parseManifestContent("version = 2", "bad.toml")).toThrow("unsupported version");
  });

  test("rejects derived visibility", () => {
    expect(() =>
      parseManifestContent(
        `version = 1\n[var.NC_CLIENT_IP]\nvisibility = "derived"\nderive = "public-ipv4"\n`,
        "bad.toml",
      ),
    ).toThrow(/invalid visibility "derived"/);
  });
});

describe("resolveVar", () => {
  test("uses project vault for project scope", async () => {
    const def: VarDefinition = {
      key: "DEPLOY_TOKEN",
      visibility: "secret",
      scope: "project",
    };

    const ctx: ResolveContext = {
      projectRoot: "/tmp/proj",
      globalManifest: null,
      projectManifest: null,
      globalSecrets: {},
      projectSecrets: { DEPLOY_TOKEN: "tok123" },
    };

    const resolved = await resolveVar(ctx, def, { includeSecrets: true });
    expect(resolved.status).toBe("set");
    expect(resolved.storage).toBe("project");
    expect(resolved.value).toBe("tok123");
  });

  test("masks secrets in doctor mode", async () => {
    const def: VarDefinition = {
      key: "NC_API_KEY",
      visibility: "secret",
      scope: "global",
    };

    const ctx: ResolveContext = {
      projectRoot: "/tmp/proj",
      globalManifest: null,
      projectManifest: null,
      globalSecrets: { NC_API_KEY: "secret-value" },
      projectSecrets: {},
    };

    const resolved = await resolveVar(ctx, def);
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

    const ctx: ResolveContext = {
      projectRoot: "/tmp/proj",
      globalManifest: null,
      projectManifest: null,
      globalSecrets: {},
      projectSecrets: {},
    };

    const resolved = await resolveVar(ctx, def, { surfacePublic: true });
    expect(resolved.value).toBe("UsysD3nN39n4Mi");
  });

  test("includes set_with when missing", async () => {
    const def: VarDefinition = {
      key: "NC_API_KEY",
      visibility: "secret",
      scope: "global",
      ask: "paste key",
    };

    const ctx: ResolveContext = {
      projectRoot: "/tmp/proj",
      globalManifest: null,
      projectManifest: null,
      globalSecrets: {},
      projectSecrets: {},
    };

    const resolved = await resolveVar(ctx, def);
    expect(resolved.status).toBe("missing");
    expect(resolved.set_with).toBe("ap set NC_API_KEY --global");
  });

  test("reads inline secret from manifest", async () => {
    const def: VarDefinition = {
      key: "CF_GLOBAL_API_KEY",
      visibility: "secret",
      scope: "global",
      value: "inline-key",
    };

    const ctx: ResolveContext = {
      projectRoot: "/tmp/proj",
      globalManifest: null,
      projectManifest: null,
      globalSecrets: {},
      projectSecrets: {},
    };

    const resolved = await resolveVar(ctx, def, { includeSecrets: true });
    expect(resolved.status).toBe("set");
    expect(resolved.storage).toBe("inline");
    expect(resolved.value).toBe("inline-key");
  });

  test("vault wins over inline secret", async () => {
    const def: VarDefinition = {
      key: "CF_GLOBAL_API_KEY",
      visibility: "secret",
      scope: "global",
      value: "inline-key",
    };

    const ctx: ResolveContext = {
      projectRoot: "/tmp/proj",
      globalManifest: null,
      projectManifest: null,
      globalSecrets: { CF_GLOBAL_API_KEY: "vault-key" },
      projectSecrets: {},
    };

    const resolved = await resolveVar(ctx, def, { includeSecrets: true });
    expect(resolved.storage).toBe("global");
    expect(resolved.value).toBe("vault-key");
  });
});

describe("bundles", () => {
  test("doctor groups by bundle and surfaces public vars", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-bundle-"));
    const globalDir = join(dir, "global");
    const prevHome = process.env.AP_GLOBAL_HOME;

    try {
      process.env.AP_GLOBAL_HOME = globalDir;
      await mkdir(globalDir, { recursive: true });
      await mkdir(join(dir, ".ap"), { recursive: true });

      await writeFile(join(dir, "ap.toml"), `version = 1\nbundles = ["namecheap"]\n`);
      await writeFile(join(globalDir, "manifest.toml"), `version = 1

[bundle.namecheap]
ask = "Namecheap setup"
vars = ["NC_API_USER", "NC_API_KEY"]

[var.NC_API_USER]
visibility = "public"
value = "testuser"

[var.NC_API_KEY]
visibility = "secret"
ask = "paste key"
`);
      await writeFile(
        join(globalDir, "secrets.json"),
        JSON.stringify({ NC_API_KEY: "key123" }) + "\n",
      );

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
    const ctx: ResolveContext = {
      projectRoot: null,
      globalManifest: parseManifestContent(`version = 1
[bundle.cloudflare]
vars = ["CF_GLOBAL_API_KEY"]
`, "g"),
      projectManifest: null,
      globalSecrets: {},
      projectSecrets: {},
    };

    const vars = await resolveAll(ctx);
    expect(vars.map((v) => v.key)).toEqual(["CF_GLOBAL_API_KEY"]);
  });

  test("resolveBundles reports missing secrets", async () => {
    const ctx: ResolveContext = {
      projectRoot: "/tmp",
      globalManifest: parseManifestContent(`version = 1
[bundle.namecheap]
vars = ["NC_API_KEY"]
`, "g"),
      projectManifest: parseManifestContent("version = 1\nbundles = [\"namecheap\"]\n", "p"),
      globalSecrets: {},
      projectSecrets: {},
    };

    const vars = await resolveAll(ctx, { surfacePublic: true });
    const bundles = await resolveBundles(ctx, vars);
    expect(bundles.namecheap.ready).toBe(false);
    expect(bundles.namecheap.missing[0]?.key).toBe("NC_API_KEY");
  });
});
