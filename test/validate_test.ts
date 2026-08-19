import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { validateVarRules } from "../src/validate.ts";

describe("validateVarRules", () => {
  test("allows inline secret when manifest is not git-tracked", () => {
    expect(() =>
      validateVarRules("CF_GLOBAL_API_KEY", "secret", {
        value: "abc",
        gitTracked: false,
        fileScope: "global",
      }),
    ).not.toThrow();
  });

  test("rejects inline secret in git-tracked manifest", () => {
    expect(() =>
      validateVarRules("DEPLOY_TOKEN", "secret", {
        value: "abc",
        gitTracked: true,
        setHint: "ap set DEPLOY_TOKEN --global",
        fileScope: "global",
      }),
    ).toThrow(/git-tracked manifest/);
  });

  test("rejects value and derive together on public vars", () => {
    expect(() =>
      validateVarRules("NC_CLIENT_IP", "public", {
        value: "1.2.3.4",
        derive: "public-ipv4",
        gitTracked: false,
      }),
    ).toThrow(/value or derive, not both/);
  });

  test("derive requires public visibility", () => {
    expect(() =>
      validateVarRules("NC_CLIENT_IP", "secret", {
        derive: "public-ipv4",
        gitTracked: false,
      }),
    ).toThrow(/derive requires visibility = "public"/);
  });

  test("rejects project secret with inline value", () => {
    expect(() =>
      validateVarRules("DEPLOY_TOKEN", "secret", {
        value: "abc",
        fileScope: "project",
        gitTracked: false,
      }),
    ).toThrow(/ap set DEPLOY_TOKEN/);
  });
});
