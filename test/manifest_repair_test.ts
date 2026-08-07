import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import {
  loadManifest,
  loadManifestDetailed,
  tryRepairManifestContent,
} from "../src/manifest.ts";

describe("tryRepairManifestContent", () => {
  test("backfills file-level scope and strips per-var scope", () => {
    const repaired = tryRepairManifestContent(
      `version = 1

[var.FOO]
visibility = "secret"
scope = "global"
ask = "paste"

[var.BAR]
visibility = "public"
scope = "global"
value = "x"
`,
      "legacy.toml",
      "global",
    );
    expect(repaired !== null).toBe(true);
    expect(repaired!.manifest.scope).toBe("global");
    expect(repaired!.manifest.vars.get("FOO")?.scope).toBe("global");
    expect(repaired!.content).toContain('scope = "global"');
    expect(repaired!.content.includes("scope = ", repaired!.content.indexOf("[var."))).toBe(false);
    expect(repaired!.repairs.some((r) => r.includes("removed [var.FOO] scope"))).toBe(true);
  });

  test("infers scope from unanimous var scopes", () => {
    const repaired = tryRepairManifestContent(
      `version = 1
[var.TOKEN]
visibility = "secret"
scope = "project"
`,
      "ap.toml",
      "global",
    );
    expect(repaired!.manifest.scope).toBe("project");
    expect(repaired!.repairs.some((r) => r.includes("from var declarations"))).toBe(true);
  });
});

describe("loadManifest autofix", () => {
  test("rewrites legacy project manifest and keeps working", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-repair-"));
    const path = join(dir, "ap.toml");
    try {
      await writeFile(
        path,
        `version = 1
bundles = ["cloudflare"]

[var.LOCAL]
visibility = "secret"
scope = "project"
`,
      );

      const detailed = await loadManifestDetailed(path);
      expect(detailed.manifest !== null).toBe(true);
      expect(detailed.repaired).toBe(true);
      expect(detailed.manifest!.scope).toBe("project");

      const onDisk = await readFile(path, "utf8");
      expect(onDisk).toContain('scope = "project"');
      expect(onDisk.includes("scope = \"project\"\n\nbundles") || onDisk.includes('scope = "project"')).toBe(true);
      expect(onDisk.includes("[var.LOCAL]\nvisibility = \"secret\"\nscope")).toBe(false);

      const again = await loadManifest(path);
      expect(again?.scope).toBe("project");
      expect(again?.vars.has("LOCAL")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not throw on unreadable garbage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-repair-"));
    const path = join(dir, "ap.toml");
    try {
      await writeFile(path, "this is { not = toml [[[");
      const manifest = await loadManifest(path);
      expect(manifest).toBe(null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("backfills missing top-level scope without per-var scope", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-repair-"));
    const path = join(dir, "manifest.toml");
    try {
      await writeFile(
        path,
        `version = 1

[var.API_KEY]
visibility = "secret"
`,
      );
      const detailed = await loadManifestDetailed(path);
      expect(detailed.repaired).toBe(true);
      expect(detailed.manifest?.scope).toBe("global");
      const onDisk = await readFile(path, "utf8");
      expect(onDisk).toContain('scope = "global"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
