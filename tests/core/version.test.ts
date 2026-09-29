import { describe, expect, it } from 'vitest';
import { isNewerVersion, normalizeVersion, parseVersionTuple } from '$core/util/version';

describe('normalizeVersion', () => {
  it('handles standard 3-part versions', () => {
    expect(normalizeVersion('3.0.0')).toBe('3.0.0');
    expect(normalizeVersion('v3.0.0')).toBe('3.0.0');
    expect(normalizeVersion('V1.2.3')).toBe('1.2.3');
  });

  it('pads 1-part and 2-part versions to 3 parts', () => {
    expect(normalizeVersion('3')).toBe('3.0.0');
    expect(normalizeVersion('3.1')).toBe('3.1.0');
    expect(normalizeVersion('v3.2')).toBe('3.2.0');
  });

  it('strips prerelease and build metadata', () => {
    expect(normalizeVersion('3.0.0-beta.1')).toBe('3.0.0');
    expect(normalizeVersion('3.0.0+build123')).toBe('3.0.0');
    expect(normalizeVersion('v3.1.0-alpha')).toBe('3.1.0');
  });

  it('handles empty or corrupt input gracefully', () => {
    expect(normalizeVersion('')).toBe('0.0.0');
    expect(normalizeVersion(null)).toBe('0.0.0');
    expect(normalizeVersion(undefined)).toBe('0.0.0');
    expect(normalizeVersion('   ')).toBe('0.0.0');
  });
});

describe('parseVersionTuple', () => {
  it('parses valid versions into [major, minor, patch]', () => {
    expect(parseVersionTuple('3.2.1')).toEqual([3, 2, 1]);
    expect(parseVersionTuple('v3.2')).toEqual([3, 2, 0]);
  });
});

describe('isNewerVersion', () => {
  it('correctly compares versions', () => {
    expect(isNewerVersion('3.0.1', '3.0.0')).toBe(true);
    expect(isNewerVersion('3.1.0', '3.0.9')).toBe(true);
    expect(isNewerVersion('4.0.0', '3.9.9')).toBe(true);
    expect(isNewerVersion('3.0.0', '3.0.0')).toBe(false);
    expect(isNewerVersion('3.0.0', '3.0.1')).toBe(false);
    expect(isNewerVersion('3.0.0', '3.1.0')).toBe(false);
    expect(isNewerVersion('2.9.9', '3.0.0')).toBe(false);
  });

  it('correctly compares with v prefix and prerelease tags', () => {
    expect(isNewerVersion('v3.0.1', '3.0.0')).toBe(true);
    expect(isNewerVersion('3.1.0-beta', '3.0.0')).toBe(true);
    expect(isNewerVersion('3.0.0-rc1', '3.0.0')).toBe(false);
  });

  it('handles padding differences without false positives', () => {
    expect(isNewerVersion('3.1', '3.0.5')).toBe(true);
    expect(isNewerVersion('3.0', '3.0.0')).toBe(false);
  });
});
