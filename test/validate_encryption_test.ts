import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runValidate } from "../src/validate.ts";
import { projectSecretsPath } from "../src/paths.ts";

describe("validate project secrets", () => {
  test("warns on plaintext secrets when not tracked", async () => {
    const root = await mkdtemp(join(tmpdir(), "ap-validate-"));
    const prevHome = process.env.AP_GLOBAL_HOME;
    try {
      process.env.AP_GLOBAL_HOME = join(root, "global");
      await mkdir(join(root, ".ap"), { recursive: true });
      await mkdir(join(root, "global"), { recursive: true });
      await writeFile(join(root, "ap.toml"), 'version = 1\nscope = "project"\nbundles = []\n');
      await writeFile(projectSecretsPath(root), '{"KEY":"secret"}\n');

      const reports = await runValidate(root);
      const secretsReport = reports.find((r) => r.path === projectSecretsPath(root));
      expect(secretsReport?.ok).toBe(true);
      expect(secretsReport?.warnings.some((w) => w.includes("ap setup") || w.includes("ap migrate"))).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.AP_GLOBAL_HOME;
      else process.env.AP_GLOBAL_HOME = prevHome;
      await rm(root, { recursive: true, force: true });
    }
  });
});
