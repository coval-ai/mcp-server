import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicationReceipt, validateSourceProfile, publishQualifiedImage, validatePublicationRequest } from './image-publication.mjs';

const valid = { source: 'a'.repeat(40), environment: 'staging', correlation: 'request-123',
  account: '123456789012', region: 'us-east-2', digest: `sha256:${'b'.repeat(64)}`,
  packageVersion: '0.6.1', runId: '123', runAttempt: '1', workflowSha: 'c'.repeat(40), archiveSha256: 'd'.repeat(64), qualifiedImageId: `sha256:${'e'.repeat(64)}` };

test('publication receipt binds source, exact digest and producer without claiming deployment', () => {
  const receipt = publicationReceipt(valid);
  assert.equal(receipt.source, valid.source);
  assert.equal(receipt.environment, valid.environment);
  assert.ok(receipt.image.endsWith(`@${valid.digest}`));
  assert.equal(receipt.producer.workflowSha, valid.workflowSha);
  assert.equal(receipt.correlation, valid.correlation);
  assert.equal(receipt.deploymentVerified, false);
  assert.equal(receipt.outcome, 'image_published');
});

for (const [field, value] of [['source', 'main'], ['digest', 'latest'], ['environment', 'prod'],
  ['correlation', 'bad\nvalue'], ['runId', ''], ['workflowSha', 'main']]) {
  test(`rejects invalid ${field}`, () => assert.throws(() => publicationReceipt({ ...valid, [field]: value })));
}

test('rejects source versions, locks or runtime that the trusted profile has not qualified', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-publication-test-'));
  try {
    for (const name of ['adapter', 'source']) {
      await mkdir(join(directory, name, 'src'), { recursive: true });
      await mkdir(join(directory, name, 'scripts'));
      for (const path of ['Dockerfile', '.dockerignore', 'tsconfig.json', 'scripts/docker-entrypoint.sh']) {
        await writeFile(join(directory, name, path), 'same-recipe');
      }
      await writeFile(join(directory, name, 'package.json'), '{"version":"0.6.1"}');
      await writeFile(join(directory, name, 'package-lock.json'), '{}');
      await writeFile(join(directory, name, 'src', 'server.ts'), 'catalog');
    }
    const check = () => validateSourceProfile(join(directory, 'adapter'), join(directory, 'source'));
    await check();
    for (const path of ['package.json', 'package-lock.json', 'src/server.ts', 'Dockerfile', '.dockerignore', 'tsconfig.json', 'scripts/docker-entrypoint.sh']) {
      const original = await readFile(join(directory, 'source', path));
      await writeFile(join(directory, 'source', path), 'unsupported');
      await assert.rejects(check(), /Unsupported source/);
      await writeFile(join(directory, 'source', path), original);
    }
    await rm(join(directory, 'source', 'scripts/docker-entrypoint.sh'));
    await symlink(join(directory, 'adapter', 'scripts/docker-entrypoint.sh'), join(directory, 'source', 'scripts/docker-entrypoint.sh'));
    await assert.rejects(check(), /Symbolic links/);
    await rm(join(directory, 'source', 'scripts/docker-entrypoint.sh'));
    await writeFile(join(directory, 'source', 'scripts/docker-entrypoint.sh'), 'same-recipe');
    await writeFile(join(directory, 'source', 'Dockerfile.dockerignore'), '**');
    const output = join(directory, 'verified-context');
    await validateSourceProfile(join(directory, 'adapter'), join(directory, 'source'), output);
    await assert.rejects(readFile(join(output, 'Dockerfile.dockerignore')), { code: 'ENOENT' });
    assert.equal(await readFile(join(output, 'Dockerfile'), 'utf8'), 'same-recipe');

  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('new producer route cannot select services or move latest; legacy route remains distinct', async () => {
  const workflow = await readFile('.github/workflows/publish-remote-image.yml', 'utf8');
  assert.ok(workflow.includes('types: [coval_mcp_image]'));
  assert.ok(!workflow.includes('aws ecs'));
  assert.ok(!workflow.includes(':latest'));
  const qualify = workflow.split('  qualify:')[1].split('  publish:')[0];
  assert.ok(!qualify.includes('id-token: write'));
  assert.ok(!qualify.includes('configure-aws-credentials'));
  assert.ok(qualify.includes('npm run qualify:image'));
  assert.ok(workflow.includes('needs: [validate, qualify]'));
  assert.ok(workflow.includes('sha256sum --check'));
  assert.ok(workflow.includes('MCP_QUALIFIED_IMAGE_ID'));
  const legacy = await readFile('.github/workflows/deploy.yml', 'utf8');
  assert.ok(legacy.includes('types: [coval_mcp_release]'));
});

function publicationFixture() {
  const manifest = JSON.stringify({ schemaVersion: 2, config: { digest: valid.qualifiedImageId }, layers: [] });
  const digest = `sha256:${createHash('sha256').update(manifest).digest('hex')}`;
  const state = { input: { ...valid, digest }, present: false, policy: null, commands: [], awsCalls: [] };
  state.aws = async (_service, operation, parameters) => {
    state.awsCalls.push({ operation, parameters });
    if (operation === 'get-lifecycle-policy') return { lifecyclePolicyText: state.policy };
    if (operation === 'batch-get-image') return state.present
      ? { images: [{ imageId: { imageDigest: digest }, imageManifest: manifest }] }
      : { images: [], failures: [{ failureCode: 'ImageNotFound' }] };
    throw new Error('Unexpected AWS operation');
  };
  state.crane = async args => {
    state.commands.push(args);
    if (args[0] === 'push') { state.present = true; return args[2]; }
    return digest;
  };
  state.run = () => publishQualifiedImage(state.input, state.aws, state.crane);
  return state;
}

test('digest-only publication uses no tag or task mutation and verifies the returned manifest', async () => {
  const state = publicationFixture();
  await state.run();
  assert.ok(state.commands.find(args => args[0] === 'push')[2].endsWith(`@${state.input.digest}`));
  assert.ok(state.awsCalls.every(call => ['get-lifecycle-policy', 'batch-get-image'].includes(call.operation)));
  assert.ok(state.awsCalls.filter(call => call.operation === 'batch-get-image')
    .every(call => !JSON.stringify(call.parameters).includes('imageTag')));
});

test('retry with the same digest is read-only and does not republish', async () => {
  const state = publicationFixture(); state.present = true;
  await state.run();
  assert.ok(!state.commands.some(args => args[0] === 'push'));
});

test('a lost push reply is accepted only after independent exact manifest readback', async () => {
  const state = publicationFixture(); const original = state.crane;
  state.crane = async args => {
    const result = await original(args);
    if (args[0] === 'push') throw new Error('lost reply');
    return result;
  };
  await state.run();
});

test('failed upload with no manifest fails closed', async () => {
  const state = publicationFixture(); const original = state.crane;
  state.crane = async args => { if (args[0] === 'push') throw new Error('upload failed'); return original(args); };
  await assert.rejects(state.run(), /did not establish/);
});

test('configured lifecycle policy blocks untagged publication before any upload', async () => {
  const state = publicationFixture(); state.policy = '{}';
  await assert.rejects(state.run(), /reviewed retention/);
  assert.ok(!state.commands.some(args => args[0] === 'push'));
});

test('substituted qualification archive is rejected before AWS metadata or upload', async () => {
  const state = publicationFixture(); state.crane = async () => `sha256:${'f'.repeat(64)}`;
  await assert.rejects(state.run(), /transferred archive/);
  assert.equal(state.awsCalls.length, 0);
});


test('publication stays inert without a provisioned dedicated publisher identity', () => {
  const request = { source: valid.source, environment: 'staging', correlation: valid.correlation };
  for (const publisherRole of [undefined, '',
    'arn:aws:iam::851725437270:role/sofia-staging-mcp-github-actions-deploy',
    'arn:aws:iam::851725437270:role/sofia-v1-mcp-image-publisher',
    'arn:aws:iam::123456789012:role/sofia-staging-mcp-image-publisher',
    'arn:aws:iam::851725437270:role/sofia-staging-mcp-image-publisher\ninjected=value']) {
    assert.throws(() => validatePublicationRequest({ ...request, publisherRole }), /not enabled/);
  }
});

for (const environment of ['staging', 'v1']) {
  test(`only the exact reviewed ${environment} publisher identity can enable its route`, () => {
    const publisherRole = `arn:aws:iam::851725437270:role/sofia-${environment}-mcp-image-publisher`;
    assert.deepEqual(validatePublicationRequest({ source: valid.source, environment,
      correlation: valid.correlation, publisherRole }), { source: valid.source, environment,
      correlation: valid.correlation, publisher_role: publisherRole });
  });
}

test('publisher identity is configured outside dispatch payloads and no deploy-role fallback exists', async () => {
  const workflow = await readFile('.github/workflows/publish-remote-image.yml', 'utf8');
  assert.ok(workflow.includes('vars.MCP_STAGING_IMAGE_PUBLISHER_ROLE_ARN'));
  assert.ok(workflow.includes('vars.MCP_PRODUCTION_IMAGE_PUBLISHER_ROLE_ARN'));
  assert.ok(workflow.includes('role-to-assume: ${{ needs.validate.outputs.publisher_role }}'));
  assert.ok(!workflow.includes('mcp-github-actions-deploy'));
  assert.ok(!workflow.includes('client_payload.publisher'));
  const validation = workflow.split('  validate:')[1].split('  qualify:')[0];
  assert.ok(!validation.includes('id-token: write'));
  assert.ok(validation.includes('node scripts/image-publication.mjs validate-request'));
});

test('the actual no-OIDC request CLI writes no outputs when authorization is unconfigured', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-authorization-test-'));
  try {
    const output = join(directory, 'outputs');
    const result = spawnSync(process.execPath, ['scripts/image-publication.mjs', 'validate-request'], {
      encoding: 'utf8', timeout: 5_000,
      env: { SOURCE: valid.source, ENVIRONMENT: 'staging', CORRELATION: valid.correlation,
        GITHUB_OUTPUT: output },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not enabled/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
    const enabled = spawnSync(process.execPath, ['scripts/image-publication.mjs', 'validate-request'], {
      encoding: 'utf8', timeout: 5_000,
      env: { SOURCE: valid.source, ENVIRONMENT: 'staging', CORRELATION: valid.correlation,
        GITHUB_OUTPUT: output,
        STAGING_PUBLISHER_ROLE: 'arn:aws:iam::851725437270:role/sofia-staging-mcp-image-publisher' },
    });
    assert.equal(enabled.status, 0);
    assert.equal(await readFile(output, 'utf8'), `source=${valid.source}\nenvironment=staging\ncorrelation=${valid.correlation}\npublisher_role=arn:aws:iam::851725437270:role/sofia-staging-mcp-image-publisher\n`);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
