import { loadResolveContext, resolveForRun } from "./resolve.ts";
import { spawnAsync } from "./spawn.ts";

export async function runCommand(
  projectRoot: string,
  cmd: string[],
  options?: { extraEnv?: Record<string, string>; bundleFilter?: string },
): Promise<number> {
  const ctx = await loadResolveContext(projectRoot);
  const resolved = await resolveForRun(ctx, { bundleFilter: options?.bundleFilter });

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...resolved,
    ...options?.extraEnv,
  };

  const { code } = await spawnAsync(cmd[0], cmd.slice(1), {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return code;
}
