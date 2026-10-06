import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
type Token = string | { comment: string } | { op: string };
const shellQuote = require('shell-quote') as {
  quote(tokens: Token[]): string;
  parse(command: string): Token[];
};

describe('Inspector command quoting', () => {
  it.each(['\n', '\r', '\u2028', '\u2029'])(
    'rejects a line terminator after a comment before producing shell input (%j)',
    (terminator) => {
      expect(() => shellQuote.quote([
        'printf', 'SAFE', { comment: 'comment' }, `a${terminator}printf INJECTED;#`,
      ])).toThrow(TypeError);
    },
  );

  it('rejects untrusted arguments appended to a parsed fragment comment', () => {
    const parsed = shellQuote.parse('printf SAFE http://example.test/#fragment');
    expect(parsed).toContainEqual({ comment: 'fragment' });
    expect(() => shellQuote.quote([...parsed, 'a\nprintf INJECTED;#']))
      .toThrow(TypeError);
  });

  it('preserves ordinary command arguments and shell metacharacters as literal data', () => {
    const args = ['two words', "single'quote", '"double"', '$HOME', '; printf INJECTED', '', 'line\nbreak'];
    const command = shellQuote.quote(['printf', '%s\\0', ...args]);
    const output = execFileSync('/bin/sh', ['-c', command], {
      encoding: 'utf8', timeout: 2_000, env: {},
    });
    expect(output).toBe(args.map((arg) => `${arg}\0`).join(''));
  });

  it('preserves parse and quote round trips used by Inspector', () => {
    const tokens = shellQuote.parse('node "server file.js" --name \'a b\'');
    expect(shellQuote.parse(shellQuote.quote(tokens)))
      .toEqual(['node', 'server file.js', '--name', 'a b']);
  });

  it('preserves a trailing comment and harmless tokens after it', () => {
    const command = shellQuote.quote(['printf', 'SAFE', { comment: 'comment' }, 'ignored']);
    expect(execFileSync('/bin/sh', ['-c', command], {
      encoding: 'utf8', timeout: 2_000, env: {},
    })).toBe('SAFE');
  });
});
