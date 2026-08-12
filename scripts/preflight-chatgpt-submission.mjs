import Ajv2020 from 'ajv/dist/2020.js';
import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const publishedSchemaUrl =
  'https://developers.openai.com/plugins/schemas/chatgpt-app-submission.v1.json';
const placeholderPattern = /<PORTAL_[A-Z_]+>/;

function usage() {
  throw new Error(
    'Usage: npm run submission:preflight -- <materialized-submission-json-outside-repository>',
  );
}

export function parsePreflightArguments(arguments_) {
  if (arguments_.length !== 1 || !arguments_[0]) usage();
  return resolve(arguments_[0]);
}

export function isOutsideRepository(path, canonicalRepositoryRoot) {
  const pathFromRepository = relative(canonicalRepositoryRoot, path);
  return pathFromRepository === '..' || pathFromRepository.startsWith(`..${sep}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function walkStrings(value, path = '$') {
  if (typeof value === 'string') return [{ path, value }];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => walkStrings(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) => walkStrings(entry, `${path}.${key}`));
}

async function builtSourceToolCatalog() {
  const { registerAllTools } = await import('../dist/tools/index.js');
  const registrations = new Map();
  registerAllTools(
    {
      registerTool(name, configuration) {
        registrations.set(name, configuration);
      },
    },
    {},
    { annotationProfile: 'standard', inputProfile: 'openai', includeSofia: true },
  );
  return registrations;
}

async function publishedSchema(fetchImpl) {
  const response = await fetchImpl(publishedSchemaUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Published OpenAI schema returned ${response.status}.`);
  return response.json();
}

export async function preflightSubmission({
  submissionPath,
  repositoryPath = repositoryRoot,
  dependencies = { readFile, realpath },
  fetchImpl = fetch,
  sourceToolCatalog = builtSourceToolCatalog,
}) {
  const canonicalRepositoryRoot = await dependencies.realpath(repositoryPath);
  const canonicalSubmissionPath = await dependencies.realpath(submissionPath);
  if (!isOutsideRepository(canonicalSubmissionPath, canonicalRepositoryRoot)) {
    throw new Error(
      'Preflight only accepts a materialized submission outside the repository, never the checked-in template.',
    );
  }

  let submission;
  try {
    submission = JSON.parse(await dependencies.readFile(canonicalSubmissionPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Unable to read materialized submission: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  assert(submission.$schema === publishedSchemaUrl, `Submission must declare ${publishedSchemaUrl}.`);
  const unresolved = walkStrings(submission).filter(({ value }) => placeholderPattern.test(value));
  assert(
    unresolved.length === 0,
    `Submission still contains reviewer fixture placeholders at ${unresolved.map(({ path }) => path).join(', ')}.`,
  );

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = await publishedSchema(fetchImpl);
  const valid = ajv.validate(schema, submission);
  assert(
    valid,
    `Submission does not match the current OpenAI schema: ${ajv.errorsText(ajv.errors, { separator: '; ' })}`,
  );

  assert(
    Array.isArray(submission.test_cases) && submission.test_cases.length >= 5,
    'Submission must include at least five positive test cases.',
  );
  assert(
    Array.isArray(submission.negative_test_cases) && submission.negative_test_cases.length >= 3,
    'Submission must include at least three negative test cases.',
  );
  for (const [index, testCase] of submission.test_cases.entries()) {
    assert(
      typeof testCase.expected_output === 'string' && testCase.expected_output.trim(),
      `Positive case ${index + 1} needs a concrete expected_output.`,
    );
  }
  for (const [index, testCase] of submission.negative_test_cases.entries()) {
    assert(
      typeof testCase.expected_output === 'string' && testCase.expected_output.trim(),
      `Negative case ${index + 1} needs a concrete expected_output.`,
    );
  }

  const sourceTools = await sourceToolCatalog();
  const submissionToolNames = Object.keys(submission.tools ?? {}).sort();
  const sourceToolNames = [...sourceTools.keys()].sort();
  assert(
    JSON.stringify(submissionToolNames) === JSON.stringify(sourceToolNames),
    `Submission tool catalog differs from the OpenAI MCP profile. Submission: ${submissionToolNames.join(', ')}. Source: ${sourceToolNames.join(', ')}.`,
  );
  for (const toolName of sourceToolNames) {
    const submittedAnnotations = submission.tools[toolName]?.annotations;
    const sourceAnnotations = sourceTools.get(toolName)?.annotations;
    for (const annotation of ['readOnlyHint', 'openWorldHint', 'destructiveHint']) {
      assert(
        submittedAnnotations?.[annotation] === sourceAnnotations?.[annotation],
        `${toolName} ${annotation} does not match the OpenAI MCP profile.`,
      );
    }
  }

  return {
    negativeCaseCount: submission.negative_test_cases.length,
    positiveCaseCount: submission.test_cases.length,
    toolCount: submissionToolNames.length,
  };
}

async function main() {
  const submissionPath = parsePreflightArguments(process.argv.slice(2));
  const result = await preflightSubmission({ submissionPath });
  console.log(
    `Submission preflight passed: ${result.toolCount} tools, ${result.positiveCaseCount} positive cases, ${result.negativeCaseCount} negative cases, and no unresolved fixture placeholders.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
