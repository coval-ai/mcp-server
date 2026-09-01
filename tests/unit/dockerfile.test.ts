import fs from 'node:fs';

describe('MCP production image base layer', () => {
  const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
  const runtimeStage = dockerfile.slice(dockerfile.indexOf('AS runtime'));

  it('applies Alpine security updates in the runtime stage', () => {
    // node:22-alpine lags Alpine's OpenSSL patches until Docker Hub respins the base, so the
    // image has to pull libcrypto3/libssl3 forward itself on every build.
    expect(runtimeStage).toContain('apk upgrade --no-cache');
  });

  it('upgrades before installing production dependencies', () => {
    const upgradeStep = runtimeStage.indexOf('apk upgrade');
    const installStep = runtimeStage.indexOf('npm ci --omit=dev');
    expect(upgradeStep).toBeGreaterThan(-1);
    expect(installStep).toBeGreaterThan(upgradeStep);
  });

  it('keeps Node development headers so bundled-OpenSSL findings stay visible', () => {
    // Node statically bundles its own OpenSSL. Removing /usr/local/include/node would drop the
    // only artifact the scanner matches on without patching the binary that terminates TLS,
    // turning an accepted risk into a silent one.
    expect(dockerfile).not.toContain('/usr/local/include/node');
  });
});
