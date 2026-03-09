import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("git-credential-hostproxy smoke tests", () => {
  const helperPath = join(process.cwd(), "container/git-credential-hostproxy");
  const tempDir = join(process.cwd(), "temp-test-helper");
  const port = 18766;
  const proxyUrl = `http://127.0.0.1:${port}`;
  let server: any;

  beforeAll(() => {
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url);
        const auth = req.headers.get("Authorization");
        const contentType = req.headers.get("Content-Type");
        const body = await req.text();

        if (auth !== "Bearer test-token") {
          return new Response("Unauthorized", { status: 401 });
        }

        if (contentType !== "text/plain; charset=utf-8") {
          return new Response("Bad Content-Type", { status: 400 });
        }

        if (url.pathname === "/fill") {
          if (body.includes("host=github.com")) {
            return new Response("protocol=https\nhost=github.com\nusername=foo\npassword=bar\n");
          }
          return new Response("");
        }
        if (url.pathname === "/approve") {
          return new Response("Approved", { status: 200 });
        }
        if (url.pathname === "/reject") {
          return new Response("Rejected", { status: 200 });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
  });

  afterAll(() => {
    server.stop();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const runHelper = async (op: string, stdin: string, env: Record<string, string> = {}) => {
    const proc = Bun.spawn([helperPath, op], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_CRED_PROXY_URL: proxyUrl,
        ...env,
      },
    });

    proc.stdin.write(stdin);
    proc.stdin.end();

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    const status = proc.exitCode;

    return { status, stdout, stderr };
  };

  test("should exit 0 for unknown operation (e.g. capability)", async () => {
    const result = await runHelper("capability", "protocol=https\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  test("get operation should send POST to /fill and return response", async () => {
    const result = await runHelper("get", "protocol=https\nhost=github.com\n", {
      GIT_CRED_PROXY_TOKEN: "test-token",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("username=foo");
    expect(result.stdout).toContain("password=bar");
  });

  test("store operation should send POST to /approve", async () => {
    const result = await runHelper("store", "protocol=https\nhost=github.com\nusername=foo\npassword=bar\n", {
      GIT_CRED_PROXY_TOKEN: "test-token",
    });
    expect(result.status).toBe(0);
  });

  test("erase operation should send POST to /reject", async () => {
    const result = await runHelper("erase", "protocol=https\nhost=github.com\n", {
      GIT_CRED_PROXY_TOKEN: "test-token",
    });
    expect(result.status).toBe(0);
  });

  test("token from GIT_CRED_PROXY_TOKEN should work", async () => {
    const result = await runHelper("get", "protocol=https\nhost=github.com\n", {
      GIT_CRED_PROXY_TOKEN: "test-token",
    });
    expect(result.status).toBe(0);
  });

  test("token from GIT_CRED_PROXY_TOKEN_FILE should work", async () => {
    const tokenFile = join(tempDir, "token");
    writeFileSync(tokenFile, "test-token\n");
    const result = await runHelper("get", "protocol=https\nhost=github.com\n", {
      GIT_CRED_PROXY_TOKEN_FILE: tokenFile,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("username=foo");
  });

  test("should fail when token is missing", async () => {
    const proc = Bun.spawn([helperPath, "get"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        GIT_CRED_PROXY_URL: proxyUrl,
        GIT_CRED_PROXY_TOKEN: "",
        GIT_CRED_PROXY_TOKEN_FILE: "",
      },
    });
    proc.stdin.write("protocol=https\n");
    proc.stdin.end();

    const stderr = await new Response(proc.stderr).text();
    await proc.exited;
    const status = proc.exitCode;

    expect(status).toBe(1);
    expect(stderr).toContain("Error: No token found");
  });

  test("should fail on non-200 response", async () => {
    const result = await runHelper("get", "protocol=https\nhost=github.com\n", {
      GIT_CRED_PROXY_TOKEN: "wrong-token",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unauthorized");
  });

  test("should contain no node or bun references", () => {
    const fs = require("node:fs");
    const content = fs.readFileSync(helperPath, "utf8");
    expect(content).not.toContain("node");
    expect(content).not.toContain("bun");
    expect(content).not.toContain(".mjs");
  });

  test("should pass bash syntax check", () => {
    const { spawnSync } = require("node:child_process");
    const result = spawnSync("bash", ["-n", helperPath]);
    expect(result.status).toBe(0);
  });
});
