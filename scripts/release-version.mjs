import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function shouldRelease(previous, current) {
  const parse = (version) => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
      throw new Error(`Expected a stable semantic version, received ${version}`);
    }
    return version.split('.').map(BigInt);
  };
  const before = parse(previous);
  const after = parse(current);
  for (let index = 0; index < before.length; index += 1) {
    if (after[index] > before[index]) return true;
    if (after[index] < before[index]) throw new Error('Package version must increase');
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , previous, current] = process.argv;
  appendFileSync(process.env.GITHUB_OUTPUT, `publish=${shouldRelease(previous, current)}\nversion=${current}\n`);
}
