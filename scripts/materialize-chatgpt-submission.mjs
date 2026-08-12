import { chmod, lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const templatePath = resolve(repositoryRoot, 'chatgpt-app-submission.template.json');
const fixtureTokenPattern = /^PORTAL_[A-Z_]+$/;
const fixtureValuePattern = /^[A-Za-z0-9_-]+$/;

function usage() {
  throw new Error(
    'Usage: npm run submission:materialize -- --fixtures <fixture-json> --output <outside-repo-json>',
  );
}

export function parseMaterializeArguments(arguments_) {
  if (arguments_.length !== 4) usage();
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (!['--fixtures', '--output'].includes(option) || !value || values.has(option)) usage();
    values.set(option, value);
  }
  return {
    fixturesPath: resolve(values.get('--fixtures')),
    outputPath: resolve(values.get('--output')),
  };
}

export function isOutsideRepository(path, canonicalRepositoryRoot) {
  const pathFromRepository = relative(canonicalRepositoryRoot, path);
  return pathFromRepository === '..' || pathFromRepository.startsWith(`..${sep}`);
}

async function readJson(path, label, readFileImpl) {
  try {
    return JSON.parse(await readFileImpl(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function fixtureTokens(template) {
  return [...new Set(JSON.stringify(template).match(/<PORTAL_[A-Z_]+>/g) ?? [])]
    .map((placeholder) => placeholder.slice(1, -1))
    .sort();
}

export function validateFixtures(fixtures, expectedTokens) {
  if (!fixtures || typeof fixtures !== 'object' || Array.isArray(fixtures)) {
    throw new Error('Fixture JSON must map PORTAL_* tokens to reviewer fixture IDs.');
  }

  const keys = Object.keys(fixtures).sort();
  const invalidKeys = keys.filter((key) => !fixtureTokenPattern.test(key));
  const missing = expectedTokens.filter((key) => !keys.includes(key));
  const extras = keys.filter((key) => !expectedTokens.includes(key));
  if (invalidKeys.length || missing.length || extras.length) {
    throw new Error(
      `Fixture keys must exactly match the template tokens. Missing: ${missing.join(', ') || 'none'}; ` +
        `extra: ${extras.join(', ') || 'none'}; invalid: ${invalidKeys.join(', ') || 'none'}.`,
    );
  }

  for (const [key, value] of Object.entries(fixtures)) {
    if (typeof value !== 'string' || !fixtureValuePattern.test(value)) {
      throw new Error(
        `${key} must be a non-empty Coval resource ID containing only letters, digits, hyphens, or underscores.`,
      );
    }
  }
}

async function canonicalOutputPath(outputPath, lstatImpl, realpathImpl) {
  try {
    const outputStatus = await lstatImpl(outputPath);
    if (outputStatus.isSymbolicLink()) {
      throw new Error('Materialized submission output must not be a symlink.');
    }
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }

  const canonicalParent = await realpathImpl(dirname(outputPath));
  return resolve(canonicalParent, basename(outputPath));
}

export async function materializeSubmission({
  fixturesPath,
  outputPath,
  repositoryPath = repositoryRoot,
  template = templatePath,
  dependencies = { chmod, lstat, readFile, realpath, writeFile },
}) {
  const canonicalRepositoryRoot = await dependencies.realpath(repositoryPath);
  const canonicalFixturesPath = await dependencies.realpath(fixturesPath);
  if (!isOutsideRepository(canonicalFixturesPath, canonicalRepositoryRoot)) {
    throw new Error('Keep reviewer fixture IDs outside the repository so they cannot be committed.');
  }

  const canonicalOutputPathValue = await canonicalOutputPath(
    outputPath,
    dependencies.lstat,
    dependencies.realpath,
  );
  if (!isOutsideRepository(canonicalOutputPathValue, canonicalRepositoryRoot)) {
    throw new Error(
      'Write the materialized submission outside the repository so reviewer fixture IDs cannot be committed.',
    );
  }

  const submissionTemplate = await readJson(template, 'submission template', dependencies.readFile);
  const fixtures = await readJson(canonicalFixturesPath, 'fixture JSON', dependencies.readFile);
  const tokens = fixtureTokens(submissionTemplate);
  validateFixtures(fixtures, tokens);

  const materialized = JSON.parse(
    JSON.stringify(submissionTemplate).replace(
      /<PORTAL_[A-Z_]+>/g,
      (placeholder) => fixtures[placeholder.slice(1, -1)],
    ),
  );

  await dependencies.writeFile(canonicalOutputPathValue, `${JSON.stringify(materialized, null, 2)}\n`, {
    mode: 0o600,
  });
  await dependencies.chmod(canonicalOutputPathValue, 0o600);
  return { outputPath: canonicalOutputPathValue, tokenCount: tokens.length };
}

async function main() {
  const { fixturesPath, outputPath } = parseMaterializeArguments(process.argv.slice(2));
  const result = await materializeSubmission({ fixturesPath, outputPath });
  console.log(
    `Materialized ${result.tokenCount} reviewer fixture IDs to ${result.outputPath}. Run npm run submission:preflight -- ${result.outputPath} before upload.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
