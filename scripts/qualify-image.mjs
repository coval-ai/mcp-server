import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const execFileAsync = promisify(execFile);
const image = process.env.COVAL_MCP_IMAGE;
const sourceSha = process.env.COVAL_MCP_SOURCE_SHA;
const expectedToolNames = [
  'consult_sofia',
  'create_agent',
  'create_run',
  'create_test_case',
  'create_test_set',
  'get_agent',
  'get_metric',
  'get_persona',
  'get_run',
  'get_test_case',
  'get_test_set',
  'list_agents',
  'list_metrics',
  'list_personas',
  'list_runs',
  'list_test_cases',
  'list_test_sets',
  'update_agent',
  'update_test_case',
].sort();
const remoteProfiles = [
  { name: 'standard', path: '/mcp' },
  { name: 'claude', path: '/claude/mcp' },
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function docker(...args) {
  return execFileAsync('docker', args, { encoding: 'utf8' });
}

async function removeContainer(containerName) {
  try {
    await docker('rm', '--force', containerName);
  } catch {
    // The container may already have stopped and removed itself.
  }
}

async function containerLogs(containerName) {
  try {
    const { stdout, stderr } = await docker('logs', containerName);
    return `${stdout}${stderr}`.trim();
  } catch {
    return 'Container logs were unavailable.';
  }
}

async function waitForHealth(baseUrl, timeoutMilliseconds = 15_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return response;
      lastError = new Error(`Health endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Image did not become healthy: ${String(lastError)}`);
}

function createFakeApi() {
  const requests = [];
  const failures = [];
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://qualification.invalid');
      invariant(request.method === 'GET', `Unexpected API method: ${request.method}`);
      invariant(url.pathname === '/v1/agents', `Unexpected API path: ${url.pathname}`);
      invariant(url.searchParams.get('page_size') === '2', 'API request omitted page_size');
      invariant(
        url.searchParams.get('order_by') === 'display_name',
        'API request omitted order_by',
      );
      invariant(
        request.headers['x-api-key'] === 'qualification-api-key',
        'API request omitted the MCP API key',
      );
      invariant(!request.headers.authorization, 'MCP forwarded an authorization header');
      requests.push({ method: request.method, path: `${url.pathname}${url.search}` });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          agents: [
            {
              id: 'agent-qualification',
              display_name: 'Qualification agent',
              model_type: 'CHAT',
              phone_number: null,
              language: 'en',
              endpoint: 'https://credential-bearing-endpoint.invalid',
              metric_ids: [],
              test_set_ids: [],
              knowledge_base_ids: [],
            },
          ],
          next_page_token: null,
        }),
      );
    } catch (error) {
      failures.push(error);
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 'QUALIFICATION_ERROR' } }));
    }
  });
  return { failures, requests, server };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', resolve);
  });
  const address = server.address();
  invariant(address && typeof address === 'object', 'Fake API did not bind a TCP port');
  return address.port;
}

async function close(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function assertToolCatalog(tools, profileName) {
  const actualNames = tools.map((tool) => tool.name).sort();
  invariant(
    JSON.stringify(actualNames) === JSON.stringify(expectedToolNames),
    `${profileName} exposed an unexpected tool catalog: ${actualNames.join(', ')}`,
  );
  for (const tool of tools) {
    invariant(tool.title, `${profileName}/${tool.name} omitted its title`);
    invariant(
      typeof tool.annotations?.readOnlyHint === 'boolean',
      `${profileName}/${tool.name} omitted readOnlyHint`,
    );
    invariant(
      typeof tool.annotations?.destructiveHint === 'boolean',
      `${profileName}/${tool.name} omitted destructiveHint`,
    );
  }

  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  invariant(
    byName.get('list_agents')?.annotations?.readOnlyHint === true,
    `${profileName} did not preserve list_agents as read-only`,
  );
  invariant(
    byName.get('create_run')?.annotations?.destructiveHint === true,
    `${profileName} did not preserve create_run as destructive`,
  );
  const expectedCreateAgentDestructive = profileName === 'claude';
  const actualCreateAgentDestructive = byName.get('create_agent')?.annotations?.destructiveHint;
  invariant(
    actualCreateAgentDestructive === expectedCreateAgentDestructive,
    `${profileName} did not preserve its create_agent risk profile: ` +
      `destructiveHint was ${actualCreateAgentDestructive}, expected ${expectedCreateAgentDestructive}`,
  );
}

function assertListAgentsResult(result, profileName) {
  invariant(result.isError !== true, `${profileName}/list_agents returned an MCP error`);
  const text = result.content?.find((item) => item.type === 'text')?.text;
  invariant(typeof text === 'string', `${profileName}/list_agents omitted text content`);
  const parsed = JSON.parse(text);
  invariant(parsed.agents?.length === 1, `${profileName}/list_agents omitted the fake agent`);
  const agent = parsed.agents[0];
  invariant(agent.id === 'agent-qualification', `${profileName}/list_agents changed the agent id`);
  invariant(agent.endpoint_configured === true, `${profileName}/list_agents lost endpoint presence`);
  invariant(!('endpoint' in agent), `${profileName}/list_agents exposed the private endpoint`);
}

async function qualifyProfile({ imageId, packageVersion, profile, upstreamPort }) {
  const containerName = `coval-mcp-qualification-${profile.name}-${process.pid}`;
  let client;
  try {
    await docker(
      'run',
      '--detach',
      '--rm',
      '--name',
      containerName,
      '--add-host',
      'host.docker.internal:host-gateway',
      '--publish',
      '127.0.0.1::8080',
      '--env',
      'CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsudGVzdCQ=',
      '--env',
      'CLERK_SECRET_KEY=sk_test_not-a-real-key',
      '--env',
      'CLERK_TELEMETRY_DISABLED=true',
      '--env',
      `COVAL_API_BASE_URL=http://host.docker.internal:${upstreamPort}/v1`,
      imageId,
    );
    const { stdout: portOutput } = await docker('port', containerName, '8080/tcp');
    const portMatch = portOutput
      .split('\n')
      .map((line) => line.trim())
      .map((line) => line.match(/^127\.0\.0\.1:(\d+)$/))
      .find(Boolean);
    invariant(portMatch, `Docker returned an invalid port mapping: ${portOutput.trim()}`);
    const baseUrl = `http://127.0.0.1:${portMatch[1]}`;
    const healthResponse = await waitForHealth(baseUrl);
    const health = await healthResponse.json();
    invariant(health.status === 'healthy', `${profile.name} image reported unhealthy`);
    invariant(health.version === packageVersion, `${profile.name} image reported the wrong version`);

    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}${profile.path}`),
      { requestInit: { headers: { 'X-API-Key': 'qualification-api-key' } } },
    );
    client = new Client({
      name: `${profile.name}-image-qualification`,
      version: '1.0.0',
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    assertToolCatalog(tools, profile.name);
    const result = await client.callTool({
      name: 'list_agents',
      arguments: { page_size: 2, order_by: 'display_name' },
    });
    assertListAgentsResult(result, profile.name);
  } catch (error) {
    const logs = await containerLogs(containerName);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${logs}`);
  } finally {
    try {
      if (client) await client.close();
    } finally {
      await removeContainer(containerName);
    }
  }
}

invariant(image, 'COVAL_MCP_IMAGE must identify the image to qualify');
invariant(
  sourceSha && /^[0-9a-f]{40}$/.test(sourceSha),
  'COVAL_MCP_SOURCE_SHA must be a lowercase 40-character commit SHA',
);

const packageJson = JSON.parse(
  await readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const { stdout: imageIdOutput } = await docker('image', 'inspect', '--format', '{{.Id}}', image);
const imageId = imageIdOutput.trim();
invariant(/^sha256:[0-9a-f]{64}$/.test(imageId), `Docker returned an invalid image id: ${imageId}`);
const { stdout: revisionOutput } = await docker(
  'image',
  'inspect',
  '--format',
  '{{index .Config.Labels "org.opencontainers.image.revision"}}',
  imageId,
);
invariant(
  revisionOutput.trim() === sourceSha,
  `Image revision ${revisionOutput.trim()} did not match ${sourceSha}`,
);
const { stdout: userOutput } = await docker(
  'image',
  'inspect',
  '--format',
  '{{.Config.User}}',
  imageId,
);
invariant(userOutput.trim() === 'node', 'Production image does not run as the node user');
const { stdout: commandOutput } = await docker(
  'image',
  'inspect',
  '--format',
  '{{json .Config.Cmd}}',
  imageId,
);
invariant(
  commandOutput.trim() === '["node","dist/remote.js"]',
  `Production image has an unexpected command: ${commandOutput.trim()}`,
);
const { stdout: entrypointOutput } = await docker(
  'image',
  'inspect',
  '--format',
  '{{json .Config.Entrypoint}}',
  imageId,
);
invariant(
  ['null', '[]'].includes(entrypointOutput.trim()),
  `Production image must leave Cmd as the effective command, but declares an entrypoint: ${entrypointOutput.trim()}`,
);
await docker(
  'run',
  '--rm',
  '--entrypoint',
  'sh',
  imageId,
  '-c',
  'test ! -e /app/src && test ! -e /app/tsconfig.json && test -f /app/dist/remote.js',
);
await docker('run', '--rm', '--entrypoint', 'npm', imageId, 'ls', '--omit=dev', '--depth=0', '--silent');

const fakeApi = createFakeApi();
const upstreamPort = await listen(fakeApi.server);
try {
  for (const profile of remoteProfiles) {
    try {
      await qualifyProfile({ imageId, packageVersion: packageJson.version, profile, upstreamPort });
    } finally {
      // A rejected upstream request surfaces to the client as an opaque MCP
      // error, so report the recorded contract failure before it propagates.
      invariant(fakeApi.failures.length === 0, `Fake API rejected a request: ${fakeApi.failures[0]}`);
    }
  }
} finally {
  await close(fakeApi.server);
}
invariant(fakeApi.failures.length === 0, `Fake API rejected a request: ${fakeApi.failures[0]}`);
invariant(
  fakeApi.requests.length === remoteProfiles.length,
  `Expected ${remoteProfiles.length} API calls, received ${fakeApi.requests.length}`,
);

console.log(
  `Qualified ${imageId} from ${sourceSha}: ${remoteProfiles.length} fresh starts, ` +
    `${expectedToolNames.length} tools per profile, and ${fakeApi.requests.length} API calls.`,
);
