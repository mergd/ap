import { describe, test } from "node:test";
import { expect } from "./expect.ts";
import { resolveSetScope } from "../src/main.ts";

describe("secret write scope", () => {
  test("defaults set and unset operations to the project vault", () => {
    expect(resolveSetScope([])).toBe("project");
  });

  test("requires an explicit global flag for global writes", () => {
    expect(resolveSetScope(["--global"])).toBe("global");
    expect(resolveSetScope(["-g"])).toBe("global");
  });

  test("keeps --project as an explicit alias for the default", () => {
    expect(resolveSetScope(["--project"])).toBe("project");
  });
});
