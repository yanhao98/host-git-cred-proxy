import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

describe("configure-git.sh tests", () => {
  const scriptPath = join(process.cwd(), "container/configure-git.sh");
  const tempDir = join(process.cwd(), "temp-test-config");
  const gitHome = join(tempDir, "home");
  const repoDir = join(tempDir, "repo");

  const runScript = (args: string[], env: Record<string, string> = {}) => {
    return spawnSync("sh", [scriptPath, ...args], {
      env: {
        ...process.env,
        HOME: gitHome,
        ...env,
      },
      cwd: repoDir,
    });
  };

  const git = (args: string[], cwd: string = repoDir) => {
    return spawnSync("git", args, {
      env: {
        ...process.env,
        HOME: gitHome,
      },
      cwd,
    }).stdout.toString().trim().split("\n").filter(Boolean);
  };

  beforeAll(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    mkdirSync(gitHome, { recursive: true });
    mkdirSync(repoDir, { recursive: true });

    spawnSync("git", ["init"], { cwd: repoDir, env: { ...process.env, HOME: gitHome } });
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("should configure global helper and be idempotent", () => {
    spawnSync("git", ["config", "--global", "--add", "credential.helper", "cache"], { env: { ...process.env, HOME: gitHome } });
    
    const result1 = runScript(["--global"]);
    expect(result1.status).toBe(0);
    
    let helpers = git(["config", "--global", "--get-all", "credential.helper"]);
    expect(helpers[0]).toBe("git-credential-hostproxy");
    expect(helpers[1]).toBe("cache");
    expect(helpers.length).toBe(2);

    const result2 = runScript(["--global"]);
    expect(result2.status).toBe(0);
    
    helpers = git(["config", "--global", "--get-all", "credential.helper"]);
    expect(helpers[0]).toBe("git-credential-hostproxy");
    expect(helpers[1]).toBe("cache");
    expect(helpers.length).toBe(2);
  });

  test("should support --local and --repo", () => {
    const otherRepo = join(tempDir, "other-repo");
    mkdirSync(otherRepo, { recursive: true });
    spawnSync("git", ["init"], { cwd: otherRepo, env: { ...process.env, HOME: gitHome } });

    spawnSync("git", ["config", "--local", "--add", "credential.helper", "store"], { cwd: otherRepo, env: { ...process.env, HOME: gitHome } });

    const result = runScript(["--local", "--repo", otherRepo]);
    expect(result.status).toBe(0);

    const helpers = git(["config", "--local", "--get-all", "credential.helper"], otherRepo);
    expect(helpers[0]).toBe("git-credential-hostproxy");
    expect(helpers[1]).toBe("store");
    expect(helpers.length).toBe(2);
  });

  test("should remove old-style path-based hostproxy entries", () => {
    spawnSync("git", ["config", "--global", "--unset-all", "credential.helper"], { env: { ...process.env, HOME: gitHome } });
    spawnSync("git", ["config", "--global", "--add", "credential.helper", "/some/path/git-credential-hostproxy"], { env: { ...process.env, HOME: gitHome } });
    spawnSync("git", ["config", "--global", "--add", "credential.helper", "osxkeychain"], { env: { ...process.env, HOME: gitHome } });

    const result = runScript(["--global"]);
    expect(result.status).toBe(0);

    const helpers = git(["config", "--global", "--get-all", "credential.helper"]);
    expect(helpers[0]).toBe("git-credential-hostproxy");
    expect(helpers[1]).toBe("osxkeychain");
    expect(helpers.length).toBe(2);
  });

  test("should set credential.useHttpPath true", () => {
    runScript(["--global"]);
    const val = spawnSync("git", ["config", "--global", "credential.useHttpPath"], { env: { ...process.env, HOME: gitHome } }).stdout.toString().trim();
    expect(val).toBe("true");
  });

  test("should support --repo path with spaces", () => {
    const spaceRepo = join(tempDir, "repo with spaces");
    mkdirSync(spaceRepo, { recursive: true });
    spawnSync("git", ["init"], { cwd: spaceRepo, env: { ...process.env, HOME: gitHome } });

    const result = runScript(["--local", "--repo", spaceRepo]);
    expect(result.status).toBe(0);

    const helpers = git(["config", "--local", "--get-all", "credential.helper"], spaceRepo);
    expect(helpers[0]).toBe("git-credential-hostproxy");
    expect(helpers.length).toBe(1);
  });
});
