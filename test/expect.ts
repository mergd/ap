import assert from "node:assert/strict";

type Matcher = string | RegExp;

function matchesError(err: unknown, pattern?: Matcher): boolean {
  if (!pattern) return true;
  const message = err instanceof Error ? err.message : String(err);
  return typeof pattern === "string" ? message.includes(pattern) : pattern.test(message);
}

export function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      assert.equal(actual, expected);
    },
    toEqual(expected: unknown) {
      assert.deepEqual(actual, expected);
    },
    toBeUndefined() {
      assert.equal(actual, undefined);
    },
    toContain(expected: string) {
      assert.match(String(actual), new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    },
    toBeLessThan(expected: number) {
      assert.ok(typeof actual === "number" && actual < expected);
    },
    not: {
      toThrow(pattern?: Matcher) {
        assert.doesNotThrow(() => {
          if (typeof actual === "function") (actual as () => void)();
        }, (err) => (pattern ? matchesError(err, pattern) : true));
      },
    },
    toThrow(pattern?: Matcher) {
      assert.throws(
        () => {
          if (typeof actual === "function") (actual as () => void)();
          else throw actual;
        },
        (err) => matchesError(err, pattern),
      );
    },
  };
}
