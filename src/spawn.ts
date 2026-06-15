import { spawn } from "node:child_process";

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: "inherit" | "ignore" | "pipe";
  stdout?: "inherit" | "ignore" | "pipe";
  stderr?: "inherit" | "ignore" | "pipe";
  detached?: boolean;
}

export function spawnAsync(
  command: string,
  args: string[],
  options: SpawnOptions = {},
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      env: options.env
        ? ({ ...process.env, ...options.env } as NodeJS.ProcessEnv)
        : process.env,
      stdio: [
        options.stdin ?? "inherit",
        options.stdout ?? "inherit",
        options.stderr ?? "inherit",
      ],
      detached: options.detached,
    });

    proc.on("error", reject);

    let stdout = "";
    if (options.stdout === "pipe" && proc.stdout) {
      proc.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
    }

    if (options.detached) {
      proc.unref();
      resolve({ code: 0, stdout: "" });
      return;
    }

    proc.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: stdout.trim() });
    });
  });
}
