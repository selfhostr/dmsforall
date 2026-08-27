import { describe, expect, it } from 'vitest';

import { modeIncluTraitementFilesAttente, modeIncluTraitementHttp } from './mode-processus';

describe('modeIncluTraitementHttp', () => {
  it('vrai en mode api', () => {
    expect(modeIncluTraitementHttp({ MODE_PROCESSUS: 'api' })).toBe(true);
  });

  it('vrai en mode combine', () => {
    expect(modeIncluTraitementHttp({ MODE_PROCESSUS: 'combine' })).toBe(true);
  });

  it('faux en mode worker — pas de HTTP métier dans le binaire worker', () => {
    expect(modeIncluTraitementHttp({ MODE_PROCESSUS: 'worker' })).toBe(false);
  });
});

describe('modeIncluTraitementFilesAttente', () => {
  it('vrai en mode worker', () => {
    expect(modeIncluTraitementFilesAttente({ MODE_PROCESSUS: 'worker' })).toBe(true);
  });

  it('vrai en mode combine', () => {
    expect(modeIncluTraitementFilesAttente({ MODE_PROCESSUS: 'combine' })).toBe(true);
  });

  it('faux en mode api — aucun processeur ne doit être enregistré', () => {
    expect(modeIncluTraitementFilesAttente({ MODE_PROCESSUS: 'api' })).toBe(false);
  });
});
