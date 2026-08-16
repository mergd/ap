import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { writeEncryptionConfig, defaultOpItem, sopsKeyRef } from "../src/encryption/config.ts";
import { initEncryptionConfig } from "../src/encryption/setup.ts";
import { isSopsEncrypted, sopsYamlContent } from "../src/encryption/sops.ts";
import { projectManifestPath, projectSecretsPath, projectVaultDir } from "../src/paths.ts";
import { writeTextFile } from "../src/fs-helpers.ts";

describe("encryption config", () => {
  test("defaultOpItem uses project basename", () => {
    expect(defaultOpItem("/Users/me/my-app")).toBe("my-app-ap-age-key");
  });

  test("sopsKeyRef builds op URI", () => {
    expect(
      sopsKeyRef({ opVault: "Personal", opItem: "my-app-ap-age-key" }),
    ).toBe("op://Personal/my-app-ap-age-key/password");
  });

  test("writes [encryption] into ap.toml", async () => {
    const root = await mkdtemp(join(tmpdir(), "ap-enc-cfg-"));
    await writeEncryptionConfig(root, { opVault: "Personal", opItem: "demo-ap-age-key" });

    const content = await readFile(projectManifestPath(root), "utf8");
    expect(content).toContain("[encryption]");
    expect(content).toContain('op_vault = "Personal"');
    expect(content).toContain('op_item = "demo-ap-age-key"');
    expect(content.includes("op_account")).toBe(false);
  });
});

describe("isSopsEncrypted", () => {
  test("detects sops metadata", () => {
    const sample = `{
  "KEY": "ENC[AES256_GCM,data:abc,tag:def]",
  "sops": { "enc": "abc" }
}`;
    expect(isSopsEncrypted(sample)).toBe(true);
  });

  test("rejects plain JSON", () => {
    expect(isSopsEncrypted('{"KEY": "secret"}\n')).toBe(false);
  });
});

describe("sopsYamlContent", () => {
  test("targets .ap/secrets.json", () => {
    const yaml = sopsYamlContent("age1testpubkey");
    expect(yaml).toContain("age1testpubkey");
    expect(yaml).toContain(".ap/secrets\\.json$");
  });
});

describe("project init vault files", () => {
  test("scaffolds secrets.json + ap.toml [encryption]", async () => {
    const root = await mkdtemp(join(tmpdir(), "ap-init-vault-"));
    await mkdir(projectVaultDir(root), { recursive: true });
    await writeTextFile(
      projectManifestPath(root),
      `version = 1\nscope = "project"\nbundles = []\n`,
    );
    await writeTextFile(projectSecretsPath(root), "{}\n");
    await initEncryptionConfig(root);

    expect(await readFile(projectSecretsPath(root), "utf8")).toBe("{}\n");
    const manifest = await readFile(projectManifestPath(root), "utf8");
    expect(manifest).toContain("[encryption]");
    expect(manifest).toContain("op_vault");
    expect(manifest).toContain('bundles = []');
  });
});
