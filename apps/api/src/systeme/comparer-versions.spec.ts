import { describe, expect, it } from 'vitest';

import { comparerVersions, normaliserVersion } from './comparer-versions';

describe('comparerVersions', () => {
  it('compare numériquement, pas en texte', () => {
    expect(comparerVersions('0.10.0', '0.9.0')).toBe(1);
    expect(comparerVersions('1.2.3', '1.2.3')).toBe(0);
    expect(comparerVersions('1.2.3', '1.3.0')).toBe(-1);
  });
  it('une préversion précède sa version finale', () => {
    expect(comparerVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(comparerVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(comparerVersions('1.0.0-alpha', '1.0.0-1')).toBe(1);
  });
  it('ignore le préfixe v et la métadonnée de build', () => {
    expect(comparerVersions('v1.0.0', '1.0.0+abc1234')).toBe(0);
  });
  it('rend null si ce n’est pas du semver', () => {
    expect(comparerVersions('local', '1.0.0')).toBeNull();
    expect(normaliserVersion('v0.3.0+x')).toBe('0.3.0');
    expect(normaliserVersion('0.0.0-image')).toBe('0.0.0-image');
    expect(normaliserVersion('n/a')).toBeNull();
  });
});
