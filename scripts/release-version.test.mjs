import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldRelease } from './release-version.mjs';

test('ordinary main commits do not release the existing version', () => {
  assert.equal(shouldRelease('0.4.0', '0.4.0'), false);
});
test('patch, minor and major version increases release', () => {
  for (const next of ['0.4.1', '0.5.0', '1.0.0']) {
    assert.equal(shouldRelease('0.4.0', next), true);
  }
});
test('a decrease fails closed instead of moving latest backwards', () => {
  for (const next of ['0.3.9', '0.4.0']) {
    assert.throws(() => shouldRelease('0.4.1', next), /must increase/);
  }
});
test('malformed versions and prereleases cannot reach the stable channel', () => {
  for (const invalid of [undefined, '', 'v0.5.0', '0.5.0-rc.1', '0.05.0', '0.5.0+meta']) {
    assert.throws(() => shouldRelease('0.4.0', invalid), /stable semantic version/);
    assert.throws(() => shouldRelease(invalid, '0.5.0'), /stable semantic version/);
  }
});
