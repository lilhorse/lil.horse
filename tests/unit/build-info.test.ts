import { describe, expect, it } from 'vitest';
import { buildVersion } from '../../src/lib/build-info';

describe('buildVersion', () => {
  it('prefers the CI commit', () => {
    expect(buildVersion({ GITHUB_SHA: 'ABCDEF0123456789' }, () => 'ffffff1')).toBe('abcdef0');
  });

  it('asks git otherwise', () => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return '70af70f\n';
    };
    expect(buildVersion({}, run)).toBe('70af70f');
    expect(calls).toEqual([['git', 'rev-parse', '--short=7', 'HEAD']]);
  });

  it('says unknown when git fails or prints something else', () => {
    expect(
      buildVersion({}, () => {
        throw new Error('not a repository');
      }),
    ).toBe('unknown');
    expect(buildVersion({ GITHUB_SHA: 'not-a-sha' }, () => 'fatal: bad\n')).toBe('unknown');
  });
});
