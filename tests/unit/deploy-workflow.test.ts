import fs from "node:fs";

describe("remote MCP deployment workflow", () => {
  const workflow = fs.readFileSync(".github/workflows/deploy.yml", "utf8");

  it("accepts correlated releases instead of direct deploys", () => {
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("types: [coval_mcp_release]");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow).toContain("release_correlation_id");
    expect(workflow).toContain("Release deploy ref and correlation id are required.");
  });

  it("deploys the requested ref with a matching immutable image tag", () => {
    expect(workflow).toContain("ref: ${{ github.event.client_payload.deploy_ref }}");
    expect(workflow).toContain('sha=$(git rev-parse HEAD)');
    expect(workflow).toContain("IMAGE_TAG: ${{ steps.source.outputs.sha }}");
    expect(workflow).toContain('docker push "${image}:${IMAGE_TAG}"');
    expect(workflow).not.toContain('docker push "${image}:${GITHUB_SHA}"');
  });

  it("keeps the public adapter environment allowlist narrow", () => {
    expect(workflow).toContain("staging|v1) ;;");
    expect(workflow).toContain('MCP_ENVIRONMENT: ${{ github.event.client_payload.environment }}');
  });
});
