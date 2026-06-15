import { loadResolveContext, resolveForRun } from "./resolve.ts";

export async function runCommand(
  projectRoot: string,
  cmd: string[],
  extraEnv?: Record<string, string>,
): Promise<number> {
  const ctx = await loadResolveContext(projectRoot);
  const resolved = await resolveForRun(ctx);

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    ...resolved,
    ...extraEnv,
  };

  const proc = Bun.spawn([cmd[0], ...cmd.slice(1)], {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  return await proc.exited;
}
