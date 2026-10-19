import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyRegistryIntegrity } from './verify-registry-integrity.mjs';

test('waits for registry metadata after a successful publish', async () => {
  let reads = 0;
  let waits = 0;
  await verifyRegistryIntegrity('0.4.1', 'expected', {
    readIntegrity: async () => {
      reads += 1;
      if (reads < 3) throw new Error('E404: package still processing');
      return 'expected';
    },
    wait: async () => { waits += 1; },
  });
  assert.equal(reads, 3);
  assert.equal(waits, 2);
});
test('fails immediately for a different published archive', async () => {
  await assert.rejects(verifyRegistryIntegrity('0.4.1', 'expected', {
    readIntegrity: async () => 'different',
    wait: async () => assert.fail('Integrity mismatches must not be retried'),
  }), /does not match/);
});
test('fails after a bounded number of unavailable registry reads', async () => {
  let reads = 0;
  let waits = 0;
  await assert.rejects(verifyRegistryIntegrity('0.4.1', 'expected', {
    attempts: 3,
    readIntegrity: async () => { reads += 1; throw new Error('registry unavailable'); },
    wait: async () => { waits += 1; },
  }), /registry unavailable/);
  assert.equal(reads, 3);
  assert.equal(waits, 2);
});
