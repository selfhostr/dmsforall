import { describe, expect, it } from 'vitest';

import {
  ALPHABET_CODE_INSTALLATION,
  afficherCodeInstallation,
  codeInstallationCorrespond,
  empreinterCodeInstallation,
  genererCodeInstallation,
  normaliserCodeInstallation,
} from './code-installation';

describe('code d’installation', () => {
  it('a la forme XXXX-XXXX-XXXX avec des caractères sans ambiguïté', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = genererCodeInstallation();
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      for (const c of code.replaceAll('-', '')) {
        expect(ALPHABET_CODE_INSTALLATION).toContain(c);
      }
      expect(code).not.toMatch(/[01OIL]/);
    }
  });

  it('tire des codes différents', () => {
    const codes = new Set(Array.from({ length: 50 }, () => genererCodeInstallation()));
    expect(codes.size).toBe(50);
  });

  it('normalise casse, tirets et espaces', () => {
    expect(normaliserCodeInstallation(' abcd efgh-jkmn ')).toBe('ABCDEFGHJKMN');
  });

  it('reconnaît le bon code quelle que soit la saisie, refuse le faux', () => {
    const code = 'ABCD-EFGH-JKMN';
    const stocke = empreinterCodeInstallation(code);
    expect(codeInstallationCorrespond('ABCD-EFGH-JKMN', stocke)).toBe(true);
    expect(codeInstallationCorrespond('abcd efgh jkmn', stocke)).toBe(true);
    expect(codeInstallationCorrespond('ABCD-EFGH-JKMP', stocke)).toBe(false);
    expect(codeInstallationCorrespond('', stocke)).toBe(false);
  });

  it('ne stocke jamais le code en clair et sale chaque empreinte', () => {
    const a = empreinterCodeInstallation('ABCD-EFGH-JKMN');
    const b = empreinterCodeInstallation('ABCD-EFGH-JKMN');
    expect(a.empreinte.equals(b.empreinte)).toBe(false);
    expect(a.empreinte.toString('latin1')).not.toContain('ABCDEFGHJKMN');
    expect(a.empreinte).toHaveLength(32);
  });

  it('affiche un bloc contenant le code et la commande de relecture', () => {
    let sortie = '';
    afficherCodeInstallation('ABCD-EFGH-JKMN', (t) => (sortie += t));
    expect(sortie).toContain("Code d'installation : ABCD-EFGH-JKMN");
    expect(sortie).toContain('docker compose logs api');
  });
});
