import { chmod, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const templatePath = resolve(repositoryRoot, 'chatgpt-app-submission.template.json');
const fixtureTokenPattern = /^PORTAL_[A-Z_]+$/;
const fixtureValuePattern = /^[A-Za-z0-9_-]+$/;

function usage() {
  throw new Error(
    'Usage: npm run submission:materialize -- --fixtures <fixture-json> --output <outside-repo-json>',
  );
}

function parseArguments(arguments_) {
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

function isOutsideRepository(path) {
  const pathFromRepository = relative(repositoryRoot, path);
  return pathFromRepository === '..' || pathFromRepository.startsWith(`..${sep}`);
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function fixtureTokens(template) {
  return [...new Set(JSON.stringify(template).match(/<PORTAL_[A-Z_]+>/g) ?? [])]
    .map((placeholder) => placeholder.slice(1, -1))
    .sort();
}

function validateFixtures(fixtures, expectedTokens) {
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

const { fixturesPath, outputPath } = parseArguments(process.argv.slice(2));
if (!isOutsideRepository(fixturesPath)) {
  throw new Error('Keep reviewer fixture IDs outside the repository so they cannot be committed.');
}
if (!isOutsideRepository(outputPath)) {
  throw new Error(
    'Write the materialized submission outside the repository so reviewer fixture IDs cannot be committed.',
  );
}

const template = await readJson(templatePath, 'submission template');
const fixtures = await readJson(fixturesPath, 'fixture JSON');
const tokens = fixtureTokens(template);
validateFixtures(fixtures, tokens);

const materialized = JSON.parse(
  JSON.stringify(template).replace(
    /<PORTAL_[A-Z_]+>/g,
    (placeholder) => fixtures[placeholder.slice(1, -1)],
  ),
);

await writeFile(outputPath, `${JSON.stringify(materialized, null, 2)}\n`, { mode: 0o600 });
await chmod(outputPath, 0o600);
console.log(
  `Materialized ${tokens.length} reviewer fixture IDs to ${outputPath}. Run npm run submission:preflight -- ${outputPath} before upload.`,
);
