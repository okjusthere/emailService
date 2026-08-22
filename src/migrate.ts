import { spawn } from "node:child_process";
import path from "node:path";
import { config } from "./config/index.js";

async function run(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: config.directDatabaseUrl },
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${String(code)}`))
    );
  });
}

export async function runMigrations(): Promise<void> {
  const prismaBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma"
  );

  await run(prismaBin, ["migrate", "deploy"]);
  await run(process.execPath, [path.join(process.cwd(), "dist", "server", "prisma", "seed.js")]);
}
