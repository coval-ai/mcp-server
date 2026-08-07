import fs from 'node:fs';

describe('MCP production image qualification', () => {
  const workflow = fs.readFileSync('.github/workflows/ci.yml', 'utf8');

  it('qualifies the exact image built from the checked-out revision', () => {
    expect(workflow).toContain('--label "org.opencontainers.image.revision=${GITHUB_SHA}"');
    expect(workflow).toContain('--build-arg "COVAL_MCP_SOURCE_SHA=${GITHUB_SHA}"');
    expect(workflow).toContain('--build-arg "COVAL_MCP_ENV=ci"');
    expect(workflow).toContain('--tag "coval-mcp:${GITHUB_SHA}"');
    expect(workflow).toContain('COVAL_MCP_IMAGE: coval-mcp:${{ github.sha }}');
    expect(workflow).toContain('COVAL_MCP_SOURCE_SHA: ${{ github.sha }}');
    expect(workflow).toContain('COVAL_MCP_ENV: ci');
    expect(workflow).toContain('run: npm run qualify:image');
  });

  it('resolves qualify:image to the qualification script', () => {
    const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(packageJson.scripts['qualify:image']).toBe('node scripts/qualify-image.mjs');
  });

  it('pins the expanded report and scheduling catalog in image qualification', () => {
    const qualifier = fs.readFileSync('scripts/qualify-image.mjs', 'utf8');
    for (const toolName of [
      'create_report',
      'get_report',
      'list_reports',
      'list_run_templates',
      'create_scheduled_run',
      'get_scheduled_run',
      'list_scheduled_runs',
      'update_scheduled_run',
    ]) {
      expect(qualifier).toContain(`'${toolName}'`);
    }
  });

  it('qualifies the image only after it has been built', () => {
    const buildStep = workflow.indexOf('name: Build production image');
    const qualifyStep = workflow.indexOf('name: Qualify production image');
    expect(buildStep).toBeGreaterThan(-1);
    expect(qualifyStep).toBeGreaterThan(buildStep);
  });
});
