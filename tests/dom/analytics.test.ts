import { beforeEach, describe, expect, it } from 'vitest';
import { BEACON_SRC, beaconLoader, beaconToken } from '../../src/lib/analytics';

const run = (token = 'abc123') => new Function(beaconLoader(token))();
const beacons = () => document.querySelectorAll(`script[src="${BEACON_SRC}"]`);
const setPrerendering = (value: boolean) =>
  Object.defineProperty(document, 'prerendering', { value, configurable: true });

beforeEach(() => {
  document.body.innerHTML = '';
  setPrerendering(false);
});

describe('beaconLoader', () => {
  it('adds the Cloudflare beacon with the site token', () => {
    run();
    expect(beacons()).toHaveLength(1);
    expect(beacons()[0]?.getAttribute('data-cf-beacon')).toBe('{"token":"abc123"}');
  });

  it('holds a prerendered page back until it is shown, then adds the beacon once', () => {
    setPrerendering(true);
    run();
    expect(beacons()).toHaveLength(0);
    setPrerendering(false);
    document.dispatchEvent(new Event('prerenderingchange'));
    document.dispatchEvent(new Event('prerenderingchange'));
    expect(beacons()).toHaveLength(1);
  });

  it('keeps a token from closing the inline script', () => {
    expect(beaconLoader('</script><b>')).not.toContain('</script');
    run('</script><b>');
    expect(beacons()[0]?.getAttribute('data-cf-beacon')).toBe('{"token":"</script><b>"}');
  });
});

describe('beaconToken', () => {
  it('ships the beacon only with a token and never from fixtures', () => {
    expect(beaconToken('', { fixtures: false })).toBeNull();
    expect(beaconToken('abc123', { fixtures: true })).toBeNull();
    expect(beaconToken('abc123', { fixtures: false })).toBe('abc123');
  });
});
