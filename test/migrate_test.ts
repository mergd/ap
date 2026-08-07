import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathExists } from "../src/fs-helpers.ts";
import { migrateAllStores } from "../src/migrate.ts";
import { loadManifest } from "../src/manifest.ts";

describe("ap migrate", () => {
  test("moves global secrets.json into manifest.toml and deletes JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-migrate-"));
    const prevHome = process.env.AP_GLOBAL_HOME;

    try {
      process.env.AP_GLOBAL_HOME = dir;
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, "manifest.toml"),
        `version = 1
scope = "global"

[var.NC_API_KEY]
visibility = "secret"
ask = "paste key"
`,
      );
      await writeFile(
        join(dir, "secrets.json"),
        JSON.stringify({ NC_API_KEY: "secret-from-json" }) + "\n",
      );

      const results = await migrateAllStores(null);
      expect(results[0]!.migrated).toEqual(["NC_API_KEY"]);
      expect(results[0]!.deletedSecretsJson).toBe(join(dir, "secrets.json"));
      expect(await pathExists(join(dir, "secrets.json"))).toBe(false);

      const manifest = await loadManifest(join(dir, "manifest.toml"));
      expect(manifest?.vars.get("NC_API_KEY")?.value).toBe("secret-from-json");
    } finally {
      if (prevHome === undefined) delete process.env.AP_GLOBAL_HOME;
      else process.env.AP_GLOBAL_HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("annotates project vault keys with storage = secrets.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ap-migrate-proj-"));
    const prevHome = process.env.AP_GLOBAL_HOME;

    try {
      process.env.AP_GLOBAL_HOME = join(dir, "global");
      await mkdir(join(dir, "global"), { recursive: true });
      await mkdir(join(dir, ".ap"), { recursive: true });
      await writeFile(join(dir, "global", "manifest.toml"), `version = 1\nscope = "global"\n`);
      await writeFile(
        join(dir, "ap.toml"),
        `version = 1
scope = "project"

[var.DEPLOY_TOKEN]
visibility = "secret"
`,
      );
      await writeFile(
        join(dir, ".ap", "secrets.json"),
        JSON.stringify({ DEPLOY_TOKEN: "tok" }) + "\n",
      );

      const results = await migrateAllStores(dir);
      const project = results.find((r) => r.manifestPath.endsWith("ap.toml"));
      expect(project?.annotated).toEqual(["DEPLOY_TOKEN"]);

      const content = await readFile(join(dir, "ap.toml"), "utf8");
      expect(content).toContain('storage = "secrets.json"');
    } finally {
      if (prevHome === undefined) delete process.env.AP_GLOBAL_HOME;
      else process.env.AP_GLOBAL_HOME = prevHome;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
