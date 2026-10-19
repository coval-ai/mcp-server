import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('the built runtime reports its installed package version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'coval-mcp-version-'));
  try {
    await mkdir(join(directory, 'dist'));
    await copyFile(new URL('../dist/version.js', import.meta.url), join(directory, 'dist/version.js'));
    await writeFile(join(directory, 'package.json'), JSON.stringify({ type: 'module', version: '1.2.3' }));
    const runtime = await import(pathToFileURL(join(directory, 'dist/version.js')).href);
    assert.equal(runtime.COVAL_MCP_SERVER_VERSION, '1.2.3');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
