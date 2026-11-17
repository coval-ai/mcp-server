import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { readFile, readdir, writeFile, lstat, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function validatePublicationRequest(input) {
  requireValue(/^[a-f0-9]{40}$/.test(input.source), 'Source must be a full commit SHA.');
  requireValue(['staging', 'v1'].includes(input.environment), 'Unsupported image environment.');
  requireValue(/^[A-Za-z0-9._:-]{1,128}$/.test(input.correlation), 'Invalid publication correlation.');
  const expectedRole = `arn:aws:iam::851725437270:role/sofia-${input.environment}-mcp-image-publisher`;
  requireValue(input.publisherRole === expectedRole,
    'Image publication is not enabled: provision and review the dedicated publisher role before configuring its exact repository variable.');
  return { source: input.source, environment: input.environment, correlation: input.correlation,
    publisher_role: expectedRole };
}

const recipeFiles = ['Dockerfile', '.dockerignore', 'tsconfig.json', 'package.json',
  'package-lock.json', 'scripts/docker-entrypoint.sh'];

async function safeRead(directory, path) {
  const parts = path.split('/');
  requireValue(parts.every(part => part && !['.', '..'].includes(part)), 'Unsafe build input path.');
  requireValue(!(await lstat(directory)).isSymbolicLink(), 'Build source cannot be a symbolic link.');
  for (let index = 1; index <= parts.length; index++) {
    const stat = await lstat(join(directory, ...parts.slice(0, index)));
    requireValue(!stat.isSymbolicLink(), 'Symbolic links are not supported in build inputs.');
    requireValue(index === parts.length ? stat.isFile() : stat.isDirectory(), 'Invalid build input type.');
  }
  return readFile(join(directory, path));
}

// Qualification code is trusted workflow code, never code executed from the requested source.
export async function validateSourceProfile(adapterDirectory, sourceDirectory, outputDirectory) {
  async function files(directory, prefix = 'src') {
    requireValue((await lstat(join(directory, prefix))).isDirectory()
      && !(await lstat(join(directory, prefix))).isSymbolicLink(), 'Invalid runtime source directory.');
    const paths = [];
    for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
      const path = join(prefix, entry.name);
      requireValue(!entry.isSymbolicLink(), 'Symbolic links are not supported in a runtime profile.');
      if (entry.isDirectory()) paths.push(...await files(directory, path));
      else if (entry.isFile()) paths.push(path);
    }
    return paths.sort();
  }
  const expected = await files(adapterDirectory);
  requireValue(isDeepStrictEqual(expected, await files(sourceDirectory)),
    'Unsupported source runtime profile; review the trusted qualification contract first.');
  const contents = [];
  for (const path of [...recipeFiles, ...expected]) {
    const bytes = await safeRead(sourceDirectory, path);
    requireValue((await safeRead(adapterDirectory, path)).equals(bytes),
      'Unsupported source metadata, build recipe or runtime profile; review the trusted qualification contract first.');
    contents.push([path, bytes]);
  }
  // Reconstruct only the verified recipe and its explicit COPY inputs. Unlisted context files
  // (including Dockerfile.dockerignore) cannot influence the build.
  if (outputDirectory) {
    await mkdir(outputDirectory, { recursive: false });
    for (const [path, bytes] of contents) {
      await mkdir(join(outputDirectory, path, '..'), { recursive: true });
      await writeFile(join(outputDirectory, path), bytes, { flag: 'wx' });
    }
  }
}

export async function publishQualifiedImage(input, aws, crane) {
  publicationReceipt(input);
  requireValue(typeof input.qualifiedManifest === 'string'
    && `sha256:${createHash('sha256').update(input.qualifiedManifest).digest('hex')}` === input.digest,
  'The publication manifest differs from the qualified artifact.');
  const expected = JSON.parse(input.qualifiedManifest);
  requireValue(expected.schemaVersion === 2 && expected.mediaType === 'application/vnd.docker.distribution.manifest.v2+json'
    && expected.config?.digest === input.qualifiedImageId && Array.isArray(expected.layers),
  'The publication manifest has an unqualified configuration.');
  const repository = `sofia-${input.environment}-mcp`;
  const uri = `${input.account}.dkr.ecr.${input.region}.amazonaws.com/${repository}@${input.digest}`;
  requireValue((await crane(['digest', '--tarball', 'publication/mcp-publication-image.tar'])).trim() === input.digest,
    'The transferred archive differs from the qualified manifest.');
  const policy = await aws('ecr', 'get-lifecycle-policy', { repositoryName: repository });
  requireValue(policy.lifecyclePolicyText === null,
    'Digest-only publication requires reviewed retention without automatic untagged expiry.');
  async function exists() {
    const result = await aws('ecr', 'batch-get-image', { repositoryName: repository,
      imageIds: [{ imageDigest: input.digest }] });
    if (Array.isArray(result.images) && result.images.length > 0
      && result.images.length <= 100 && !result.failures?.length) {
      const manifest = result.images[0].imageManifest;
      for (const image of result.images) {
        requireValue(image.imageId?.imageDigest === input.digest
          && typeof image.imageManifest === 'string' && image.imageManifest === manifest
          && image.imageManifest === input.qualifiedManifest
          && `sha256:${createHash('sha256').update(image.imageManifest).digest('hex')}` === input.digest
          && JSON.parse(image.imageManifest).config?.digest === input.qualifiedImageId,
        'Registry manifest or configuration differs from the qualified artifact.');
      }
      return true;
    }
    requireValue(!result.images?.length && result.failures?.length === 1
      && result.failures[0].failureCode === 'ImageNotFound', 'Unable to establish image-digest identity.');
    return false;
  }
  if (!await exists()) {
    try { requireValue((await crane(['push', 'publication/mcp-publication-image.tar', uri])).trim() === uri,
      'The publisher returned an unexpected image identity.'); }
    catch { /* An uncertain response is accepted only after exact independent registry readback. */ }
    requireValue(await exists(), 'Image publication did not establish the qualified manifest.');
  }
  requireValue((await crane(['digest', uri])).trim() === input.digest,
    'Independent registry digest readback differs from qualification.');
  return { digest: input.digest };
}

export function publicationReceipt(input) {
  requireValue(/^[a-f0-9]{40}$/.test(input.source), 'Source must be a full commit SHA.');
  requireValue(['staging', 'v1'].includes(input.environment), 'Unsupported image environment.');
  requireValue(/^[A-Za-z0-9._:-]{1,128}$/.test(input.correlation), 'Invalid publication correlation.');
  requireValue(/^\d{12}$/.test(input.account) && /^[a-z0-9-]+$/.test(input.region),
    'Invalid image registry identity.');
  requireValue(/^sha256:[a-f0-9]{64}$/.test(input.digest), 'An immutable image digest is required.');
  requireValue(/^\d+$/.test(input.runId) && /^\d+$/.test(input.runAttempt)
    && /^[a-f0-9]{40}$/.test(input.workflowSha), 'Invalid producer identity.');
  requireValue(/^[a-f0-9]{64}$/.test(input.archiveSha256)
    && /^sha256:[a-f0-9]{64}$/.test(input.qualifiedImageId), 'Invalid qualification artifact identity.');
  const repository = `sofia-${input.environment}-mcp`;
  return {
    schema: 'coval-mcp-image-v1',
    outcome: 'image_published',
    source: input.source,
    environment: input.environment,
    correlation: input.correlation,
    image: `${input.account}.dkr.ecr.${input.region}.amazonaws.com/${repository}@${input.digest}`,
    packageVersion: input.packageVersion,
    publicationMode: 'digest-only',
    archiveSha256: input.archiveSha256,
    qualifiedImageId: input.qualifiedImageId,
    producer: { repository: 'coval-ai/mcp-server', workflow: 'publish-remote-image.yml',
      workflowSha: input.workflowSha, runId: input.runId, runAttempt: input.runAttempt },
    qualification: 'remote-image-protocol-and-source-profile',
    deploymentVerified: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'validate-request') {
      const env = process.env;
      const request = validatePublicationRequest({ source: env.SOURCE, environment: env.ENVIRONMENT,
        correlation: env.CORRELATION, publisherRole: env.ENVIRONMENT === 'staging'
          ? env.STAGING_PUBLISHER_ROLE : env.PRODUCTION_PUBLISHER_ROLE });
      await writeFile(env.GITHUB_OUTPUT, Object.entries(request).map(([key, value]) => `${key}=${value}\n`).join(''));
    } else if (process.argv[2] === 'validate-source') {
      await validateSourceProfile('.', 'image-source', 'verified-build-context');
    } else if (process.argv[2] === 'publish') {
      const env = process.env;
      const manifest = JSON.parse(await readFile('package.json', 'utf8'));
      const input = { source: env.MCP_SOURCE_SHA,
        environment: env.MCP_ENVIRONMENT, correlation: env.MCP_CORRELATION,
        account: env.MCP_ACCOUNT_ID, region: env.AWS_REGION, digest: env.MCP_EXPECTED_MANIFEST,
        archiveSha256: env.MCP_ARCHIVE_SHA256, qualifiedImageId: env.MCP_QUALIFIED_IMAGE_ID,
        qualifiedManifest: await readFile('publication/mcp-publication-manifest.json', 'utf8'),
        packageVersion: manifest.version, runId: env.GITHUB_RUN_ID,
        runAttempt: env.GITHUB_RUN_ATTEMPT, workflowSha: env.GITHUB_SHA };
      const execute = promisify(execFile);
      async function command(binary, args) {
        try { return (await execute(binary, args, { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 })).stdout; }
        catch { throw new Error(`${binary} publication command failed.`); }
      }
      async function aws(service, operation, parameters) {
        try {
          const result = await execute('aws', [service, operation, '--cli-input-json', JSON.stringify(parameters),
            '--output', 'json', '--no-cli-pager'], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
          return JSON.parse(result.stdout);
        } catch (error) {
          if (operation === 'get-lifecycle-policy' && /\(LifecyclePolicyNotFoundException\)/.test(error.stderr ?? '')) {
            return { lifecyclePolicyText: null };
          }
          throw new Error('Registry metadata verification failed.');
        }
      }
      const published = await publishQualifiedImage(input, aws, args => command('crane', args));
      const receipt = publicationReceipt({ ...input, digest: published.digest });
      await writeFile('mcp-image-publication.json', `${JSON.stringify(receipt, null, 2)}\n`);
    } else throw new Error('Specify validate-request, validate-source or publish.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
