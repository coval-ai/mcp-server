import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

describe("remote MCP release source authorization", () => {
  const workflow = fs.readFileSync(".github/workflows/deploy.yml", "utf8");
  const runBlock = workflow.match(/        run: \|\n((?:          .*\n|\n)+)/);
  if (!runBlock) throw new Error("Release validation shell was not found");
  const script = runBlock[1].split("\n").map((line) => line.slice(10)).join("\n");
  const sourceSha = "a".repeat(40);
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-source-gate-"));
    fs.writeFileSync(path.join(directory, "gh"), [
      "#!/bin/sh",
      'printf "%s\\n" "$@" > "$COMPARISON_CALL"',
      '[ "$FAKE_GH_FAILURE" = "false" ] || exit 1',
      'printf "%s\\n" "$FAKE_COMPARISON"',
      "",
    ].join("\n"), { mode: 0o755 });
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  function run(overrides: Record<string, string> = {}) {
    return spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "coval-ai/mcp-server",
        GITHUB_REF: "refs/heads/main",
        DEPLOY_REF: sourceSha,
        MCP_ENVIRONMENT: "staging",
        RELEASE_CORRELATION_ID: "release-1",
        GITHUB_OUTPUT: path.join(directory, "outputs"),
        GH_TOKEN: "synthetic-test-token",
        COMPARISON_CALL: path.join(directory, "comparison-call"),
        FAKE_COMPARISON: "identical",
        FAKE_GH_FAILURE: "false",
        ...overrides,
      },
    });
  }

  it.each(["identical", "ahead"])("allows reviewed source when main is %s", (comparison) => {
    const result = run({ FAKE_COMPARISON: comparison });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(directory, "outputs"), "utf8")).toBe(
      `deploy_ref=${sourceSha}\nenvironment=staging\nrelease_correlation_id=release-1\n`,
    );
    expect(fs.readFileSync(path.join(directory, "comparison-call"), "utf8")).toContain(
      `repos/coval-ai/mcp-server/compare/${sourceSha}...main`,
    );
  });

  it("normalizes an accepted uppercase SHA before checking and emitting it", () => {
    const result = run({ DEPLOY_REF: sourceSha.toUpperCase() });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(directory, "outputs"), "utf8")).toContain(`deploy_ref=${sourceSha}\n`);
  });

  it.each(["behind", "diverged", "null", "", "unexpected"])("rejects unapproved comparison %s", (comparison) => {
    expect(run({ FAKE_COMPARISON: comparison }).status).not.toBe(0);
    expect(fs.existsSync(path.join(directory, "outputs"))).toBe(false);
  });

  it.each([
    { GITHUB_REF: "refs/heads/unreviewed" },
    { GITHUB_REF: "refs/tags/main" },
    { GITHUB_REPOSITORY: "untrusted/mcp-server" },
    { DEPLOY_REF: "main" },
    { DEPLOY_REF: "a".repeat(39) },
    { MCP_ENVIRONMENT: "unapproved" },
    { RELEASE_CORRELATION_ID: "" },
    { RELEASE_CORRELATION_ID: `release-1\ndeploy_ref=${"b".repeat(40)}` },
    { RELEASE_CORRELATION_ID: "release-1\renvironment=production" },
  ])("rejects untrusted input before API use: %j", (overrides) => {
    expect(run(overrides).status).not.toBe(0);
    expect(fs.existsSync(path.join(directory, "comparison-call"))).toBe(false);
    expect(fs.existsSync(path.join(directory, "outputs"))).toBe(false);
  });

  it("fails closed when GitHub comparison authentication fails", () => {
    expect(run({ FAKE_GH_FAILURE: "true" }).status).not.toBe(0);
    expect(fs.existsSync(path.join(directory, "outputs"))).toBe(false);
  });

  it("withholds OIDC permission from validation and gates deployment on validation", () => {
    const beforeJobs = workflow.split("jobs:")[0];
    const validationJob = workflow.split("  validate:")[1].split("  deploy:")[0];
    expect(beforeJobs).not.toContain("id-token: write");
    expect(validationJob).not.toContain("id-token: write");
    expect(workflow).toContain("  deploy:\n    needs: validate");
    expect(workflow.split("  deploy:")[1]).toContain("id-token: write");
  });
});
