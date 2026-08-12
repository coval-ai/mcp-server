import {
  copyFile,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const templatePath = fileURLToPath(
  new URL('../../chatgpt-app-submission.template.json', import.meta.url),
);
const template = JSON.parse(await readFile(templatePath, 'utf8')) as {
  $schema: string;
  negative_test_cases: unknown[];
  test_cases: Array<{ user_prompt: string }>;
  tools: Record<string, { annotations: Record<string, boolean> }>;
};
const materializer = await import(
  new URL('../../scripts/materialize-chatgpt-submission.mjs', import.meta.url).href,
);
const preflight = await import(
  new URL('../../scripts/preflight-chatgpt-submission.mjs', import.meta.url).href,
);

const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' };

function matchingSourceToolCatalog() {
  return async () =>
    new Map(
      Object.entries(template.tools).map(([name, tool]) => [name, { annotations: tool.annotations }]),
    );
}

function schemaFetch(schemaToReturn = schema) {
  return async () =>
    new Response(JSON.stringify(schemaToReturn), {
      headers: { 'content-type': 'application/schema+json' },
      status: 200,
    });
}

function fixtures() {
  const tokens = new Set(
    template.test_cases.flatMap(({ user_prompt }) =>
      [...user_prompt.matchAll(/<PORTAL_([A-Z_]+)>/g)].map(([, token]) => `PORTAL_${token}`),
    ),
  );

  return Object.fromEntries(
    [...tokens].map((token) => [
      token,
      token === 'PORTAL_TEST_SET_ID' ? 'ReviewSet' : `review_${token.slice('PORTAL_'.length).toLowerCase()}`,
    ]),
  );
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

describe('ChatGPT submission scripts', () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'coval-chatgpt-submission-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { force: true, recursive: true });
  });

  it('rejects incomplete or malformed materializer arguments', () => {
    expect(() => materializer.parseMaterializeArguments([])).toThrow('Usage:');
    expect(() => materializer.parseMaterializeArguments(['--fixtures', 'fixtures.json'])).toThrow(
      'Usage:',
    );
    expect(() => preflight.parsePreflightArguments([])).toThrow('Usage:');
  });

  it('materializes and preflights a complete outside-repository submission', async () => {
    const fixturesPath = join(temporaryDirectory, 'fixtures.json');
    const outputPath = join(temporaryDirectory, 'submission.json');
    await writeJson(fixturesPath, fixtures());

    const result = await materializer.materializeSubmission({ fixturesPath, outputPath });
    expect(result.tokenCount).toBe(8);
    expect(JSON.stringify(JSON.parse(await readFile(outputPath, 'utf8')))).not.toContain('<PORTAL_');

    await expect(
      preflight.preflightSubmission({
        fetchImpl: schemaFetch(),
        sourceToolCatalog: matchingSourceToolCatalog(),
        submissionPath: outputPath,
      }),
    ).resolves.toEqual({ negativeCaseCount: 3, positiveCaseCount: 5, toolCount: 27 });
  });

  it('rejects missing or malformed fixture values', async () => {
    const fixturesPath = join(temporaryDirectory, 'fixtures.json');
    await writeJson(fixturesPath, { ...fixtures(), PORTAL_AGENT_ID: 'bad/id' });

    await expect(
      materializer.materializeSubmission({
        fixturesPath,
        outputPath: join(temporaryDirectory, 'submission.json'),
      }),
    ).rejects.toThrow('PORTAL_AGENT_ID must be a non-empty Coval resource ID');

    await writeJson(fixturesPath, { PORTAL_AGENT_ID: 'review_agent' });
    await expect(
      materializer.materializeSubmission({
        fixturesPath,
        outputPath: join(temporaryDirectory, 'submission.json'),
      }),
    ).rejects.toThrow('Fixture keys must exactly match');
  });

  it('rejects repository paths and symlinks that could store fixture data in the repository', async () => {
    const externalFixturesPath = join(temporaryDirectory, 'fixtures.json');
    await writeJson(externalFixturesPath, fixtures());

    await expect(
      materializer.materializeSubmission({
        fixturesPath: templatePath,
        outputPath: join(temporaryDirectory, 'submission.json'),
      }),
    ).rejects.toThrow('outside the repository');

    const fixtureSymlink = join(temporaryDirectory, 'fixtures-link.json');
    await symlink(templatePath, fixtureSymlink);
    await expect(
      materializer.materializeSubmission({
        fixturesPath: fixtureSymlink,
        outputPath: join(temporaryDirectory, 'submission.json'),
      }),
    ).rejects.toThrow('outside the repository');

    const outputSymlink = join(temporaryDirectory, 'submission-link.json');
    await symlink(templatePath, outputSymlink);
    await expect(
      materializer.materializeSubmission({
        fixturesPath: externalFixturesPath,
        outputPath: outputSymlink,
      }),
    ).rejects.toThrow('must not be a symlink');
  });

  it('rejects unresolved placeholders, schema failures, and tool-profile drift', async () => {
    const unresolvedPath = join(temporaryDirectory, 'unresolved.json');
    await copyFile(templatePath, unresolvedPath);
    await expect(
      preflight.preflightSubmission({
        fetchImpl: schemaFetch(),
        sourceToolCatalog: matchingSourceToolCatalog(),
        submissionPath: unresolvedPath,
      }),
    ).rejects.toThrow('still contains reviewer fixture placeholders');

    const fixturesPath = join(temporaryDirectory, 'fixtures.json');
    const materializedPath = join(temporaryDirectory, 'materialized.json');
    await writeJson(fixturesPath, fixtures());
    await materializer.materializeSubmission({ fixturesPath, outputPath: materializedPath });

    await expect(
      preflight.preflightSubmission({
        fetchImpl: schemaFetch({ required: ['missing'] }),
        sourceToolCatalog: matchingSourceToolCatalog(),
        submissionPath: materializedPath,
      }),
    ).rejects.toThrow('does not match the current OpenAI schema');

    await expect(
      preflight.preflightSubmission({
        fetchImpl: schemaFetch(),
        sourceToolCatalog: async () => new Map(),
        submissionPath: materializedPath,
      }),
    ).rejects.toThrow('tool catalog differs from the OpenAI MCP profile');
  });

  it('canonicalizes the preflight path before enforcing the repository boundary', async () => {
    const submissionSymlink = join(temporaryDirectory, 'submission-link.json');
    await symlink(templatePath, submissionSymlink);

    await expect(
      preflight.preflightSubmission({
        fetchImpl: schemaFetch(),
        sourceToolCatalog: matchingSourceToolCatalog(),
        submissionPath: submissionSymlink,
      }),
    ).rejects.toThrow('outside the repository');
  });
});
