import fs from 'node:fs';

describe('MCP production image qualification', () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');

  it('qualifies the exact image built from the checked-out revision', () => {
    expect(workflow).toContain('--label "org.opencontainers.image.revision=${GITHUB_SHA}"');
    expect(workflow).toContain('--tag "coval-mcp:${GITHUB_SHA}"');
    expect(workflow).toContain('COVAL_MCP_IMAGE: coval-mcp:${{ github.sha }}');
    expect(workflow).toContain('COVAL_MCP_SOURCE_SHA: ${{ github.sha }}');
    expect(workflow).toContain('run: npm run qualify:image');
  });
});
