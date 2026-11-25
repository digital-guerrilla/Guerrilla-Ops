const assert = require('node:assert/strict');
const { test } = require('node:test');
const { nextReleaseTag } = require('../scripts/next-release.cjs');

test('preserves the initial version when no stable tags exist', () => {
  assert.equal(nextReleaseTag(''), 'v1.1.1');
  assert.equal(nextReleaseTag('preview\nv2.0.0-rc.1'), 'v1.1.1');
});

test('increments the last release patch', () => {
  assert.equal(nextReleaseTag('v1.1.4\nv1.1.5\n'), 'v1.1.6');
});

test('orders versions numerically rather than lexically or by tag date', () => {
  assert.equal(nextReleaseTag('v1.9.99\nv1.10.2\nv1.10.10\nv1.10.3'), 'v1.10.11');
  assert.equal(nextReleaseTag('v2.0.0\nv1.99.99'), 'v2.0.1');
});

test('ignores malformed versions and prereleases', () => {
  assert.equal(nextReleaseTag('v1.1.5\r\nv9.0.0-rc.1\r\nv9.0.0-extra\r\nv01.0.0\r\nv9x0x0'), 'v1.1.6');
});

test('does not lose precision for large version numbers', () => {
  assert.equal(nextReleaseTag('v1.0.9007199254740993'), 'v1.0.9007199254740994');
});
