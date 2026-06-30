import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { defaultOpItem, sopsKeyRef } from "../src/encryption/config.ts";
import { isSopsEncrypted, sopsYamlContent } from "../src/encryption/sops.ts";

describe("encryption config", () => {
  test("defaultOpItem uses project basename", () => {
    expect(defaultOpItem("/Users/me/my-app")).toBe("my-app-ap-age-key");
  });

  test("sopsKeyRef builds op URI", () => {
    expect(
      sopsKeyRef({ opVault: "Personal", opItem: "my-app-ap-age-key" }),
    ).toBe("op://Personal/my-app-ap-age-key/password");
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
