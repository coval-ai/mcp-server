import fs from "node:fs";

describe("remote MCP deployment workflow", () => {
  const workflow = fs.readFileSync(".github/workflows/deploy.yml", "utf8");

  it("accepts correlated releases instead of direct deploys", () => {
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toContain("types: [coval_mcp_release]");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow).toContain("release_correlation_id");
    expect(workflow).toContain("Release correlation id is required.");
  });

  it("deploys the requested ref with a matching immutable image tag", () => {
    expect(workflow).toContain(
      "Release deploy ref must be an immutable 40-character commit SHA.",
    );
    expect(workflow).toContain("ref: ${{ needs.validate.outputs.deploy_ref }}");
    expect(workflow).toContain('sha=$(git rev-parse HEAD)');
    expect(workflow).toContain("IMAGE_TAG: ${{ steps.source.outputs.sha }}");
    expect(workflow).toContain('--build-arg "COVAL_MCP_SOURCE_SHA=${IMAGE_TAG}"');
    expect(workflow).toContain('--build-arg "COVAL_MCP_ENV=${MCP_ENVIRONMENT}"');
    expect(workflow).toContain('docker push "${image}:${IMAGE_TAG}"');
    expect(workflow).not.toContain('docker push "${image}:${GITHUB_SHA}"');
  });

  it("keeps the public adapter environment allowlist narrow", () => {
    expect(workflow).toContain("staging|v1) ;;");
    expect(workflow).toContain("needs: validate");
    expect(workflow).toContain(
      "environment: ${{ needs.validate.outputs.environment == 'v1' && 'production' || 'staging' }}",
    );
    expect(workflow).toContain(
      "group: mcp-${{ needs.validate.outputs.environment }}-deploy",
    );
    expect(workflow).toContain(
      "MCP_ENVIRONMENT: ${{ needs.validate.outputs.environment }}",
    );
  });
});
