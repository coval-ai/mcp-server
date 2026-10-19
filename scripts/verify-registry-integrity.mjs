import { execFile } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function verifyRegistryIntegrity(version, expected, options = {}) {
  const {
    attempts = 15,
    wait = () => setTimeout(20000),
    readIntegrity = async () => {
      const { stdout } = await execute('npm', [
        'view', `@coval/mcp-server@${version}`, 'dist.integrity',
        '--fetch-retries=0', '--fetch-timeout=15000', '--prefer-online',
      ], { timeout: 20000 });
      return stdout.trim();
    },
  } = options;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let actual;
    try {
      actual = await readIntegrity();
    } catch (error) {
      if (attempt === attempts) throw error;
      console.error(`Registry metadata unavailable; retry ${attempt}/${attempts}.`);
      await wait();
      continue;
    }
    if (actual !== expected) throw new Error('Published archive integrity does not match the verified package');
    return;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyRegistryIntegrity(process.argv[2], process.argv[3]);
}
