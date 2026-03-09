import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Elysia } from "elysia";

import { createContainerRoutes } from "../../host/src/routes/container";

const LOCALHOST = "127.0.0.1";

describe("container install.sh smoke", () => {
  const tempPaths = new Set<string>();

  afterEach(async () => {
    for (const tempPath of tempPaths) {
      await rm(tempPath, { recursive: true, force: true });
      tempPaths.delete(tempPath);
    }
  });

  test("installs helper + configure script into INSTALL_DIR", async () => {
    const installDir = await createTempDir("install-smoke-");
    tempPaths.add(installDir);
    const port = await reservePort();
    const publicUrl = `http://${LOCALHOST}:${port}`;

    const app = new Elysia().use(
      createContainerRoutes({
        config: {
          host: LOCALHOST,
          port,
          publicUrl,
          protocols: ["https"],
          allowedHosts: [],
          requestHistoryLimit: 200,
          openBrowserOnStart: false,
        },
      }),
    );

    app.listen({ hostname: LOCALHOST, port });

    try {
      const result = await runShell(`curl -fsSL ${publicUrl}/container/install.sh | sh`, {
        ...process.env,
        INSTALL_DIR: installDir,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Next steps:");
      expect(result.stdout).toContain("/run/host-git-cred-proxy/token");

      const helperPath = join(installDir, "git-credential-hostproxy");
      const configurePath = join(installDir, "configure-git.sh");

      await expectExecutable(helperPath);
      await expectExecutable(configurePath);
    } finally {
      await app.stop(true);
    }
  });
});

async function createTempDir(prefix: string): Promise<string> {
  const tempPath = await mkdtemp(join(tmpdir(), prefix));
  return tempPath;
}

async function expectExecutable(filePath: string): Promise<void> {
  const fileStats = await stat(filePath);
  expect(fileStats.isFile()).toBe(true);
  expect(fileStats.mode & 0o111).toBeGreaterThan(0);
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();

    server.on("error", reject);

    server.listen(0, LOCALHOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to reserve TCP port"));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });
  });
}

async function runShell(command: string, env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["sh", "-lc", command], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  return {
    status: proc.exitCode,
    stdout,
    stderr,
  };
}
