import { describe, expect, it, vi } from 'vitest';

import {
  creerGarage,
  deriverSlug,
  ErreurCreerGarage,
  type ExecuteurSql,
} from './creer-garage.service';

type Reponse = { rows: Array<Record<string, unknown>> };

/** Faux exécuteur : rejoue des réponses selon un fragment de SQL, enregistre tout ce qui est envoyé. */
function fauxExecuteur(
  reponses: Array<[string, Reponse | Error]> = [],
): ExecuteurSql & { appels: Array<{ texte: string; valeurs: readonly unknown[] }> } {
  const appels: Array<{ texte: string; valeurs: readonly unknown[] }> = [];
  return {
    appels,
    async query(texte: string, valeurs: readonly unknown[] = []) {
      appels.push({ texte, valeurs });
      const trouve = reponses.find(([fragment]) => texte.includes(fragment));
      if (trouve) {
        if (trouve[1] instanceof Error) throw trouve[1];
        return trouve[1];
      }
      if (texte.includes('insert into tenant')) return { rows: [{ id: 'tenant-1' }] };
      if (texte.includes('insert into site')) return { rows: [{ id: 'site-1' }] };
      if (texte.includes('insert into utilisateur ')) return { rows: [{ id: 'user-1' }] };
      return { rows: [] };
    },
  };
}

const hacher = vi.fn(async (clair: string) => `hash(${clair})`);
const entreeValide = {
  garage: 'Garage Exemple',
  email: 'Direction@Example.ch',
  motDePasse: 'Correct-Horse-Battery-42',
  prenom: 'Direction',
  nom: 'Garage',
};

describe('deriverSlug', () => {
  it('normalise accents, espaces et ponctuation', () => {
    expect(deriverSlug('Garage de l’Étoile & Fils SA')).toBe('garage-de-l-etoile-fils-sa');
  });
  it('refuse un nom sans caractère exploitable', () => {
    expect(() => deriverSlug('!!')).toThrow(ErreurCreerGarage);
  });
});

describe('creerGarage', () => {
  it('crée tenant, site, utilisateur direction et audit dans une transaction', async () => {
    const bd = fauxExecuteur();
    const res = await creerGarage(bd, entreeValide, hacher);
    const textes = bd.appels.map((a) => a.texte);
    expect(textes[0]).toBe('begin');
    expect(textes.at(-1)).toBe('commit');
    expect(textes.some((t) => t.includes('insert into audit_utilisateur'))).toBe(true);
    const insertUser = bd.appels.find((a) => a.texte.includes('insert into utilisateur '));
    expect(insertUser?.valeurs).toContain('direction@example.ch');
    expect(insertUser?.valeurs).toContain('hash(Correct-Horse-Battery-42)');
    expect(insertUser?.texte).toContain("'direction'");
    expect(res).toEqual({
      tenantId: 'tenant-1',
      slug: 'garage-exemple',
      siteId: 'site-1',
      siteCode: 'PRINCIPAL',
      utilisateurId: 'user-1',
      email: 'direction@example.ch',
      role: 'direction',
    });
  });

  it('refuse un mot de passe trop court sans toucher la base', async () => {
    const bd = fauxExecuteur();
    await expect(
      creerGarage(bd, { ...entreeValide, motDePasse: 'court1!' }, hacher),
    ).rejects.toMatchObject({
      code: 'MOT_DE_PASSE_FAIBLE',
    });
    expect(bd.appels).toHaveLength(0);
  });

  it('refuse un mot de passe commun', async () => {
    const bd = fauxExecuteur();
    await expect(
      creerGarage(bd, { ...entreeValide, motDePasse: 'password1234' }, hacher),
    ).rejects.toMatchObject({ code: 'MOT_DE_PASSE_FAIBLE' });
    expect(bd.appels).toHaveLength(0);
  });

  it('refuse un mot de passe contenant la partie locale du courriel', async () => {
    const bd = fauxExecuteur();
    await expect(
      creerGarage(bd, { ...entreeValide, motDePasse: 'xx-direction-Zq93!k' }, hacher),
    ).rejects.toMatchObject({ code: 'MOT_DE_PASSE_FAIBLE' });
    expect(bd.appels).toHaveLength(0);
  });

  it('refuse un courriel invalide', async () => {
    const bd = fauxExecuteur();
    await expect(
      creerGarage(bd, { ...entreeValide, email: 'pas-un-courriel' }, hacher),
    ).rejects.toMatchObject({ code: 'COURRIEL_INVALIDE' });
  });

  it('refuse si le courriel existe déjà : rollback, aucune insertion', async () => {
    const bd = fauxExecuteur([['from utilisateur', { rows: [{ id: 'x' }] }]]);
    await expect(creerGarage(bd, entreeValide, hacher)).rejects.toMatchObject({
      code: 'COURRIEL_EXISTANT',
    });
    const textes = bd.appels.map((a) => a.texte);
    expect(textes.at(-1)).toBe('rollback');
    expect(textes.some((t) => t.startsWith('insert'))).toBe(false);
  });

  it('refuse si le garage existe déjà : rollback, aucune insertion', async () => {
    const bd = fauxExecuteur([['from tenant', { rows: [{ id: 'x' }] }]]);
    await expect(creerGarage(bd, entreeValide, hacher)).rejects.toMatchObject({
      code: 'GARAGE_EXISTANT',
    });
    const textes = bd.appels.map((a) => a.texte);
    expect(textes.at(-1)).toBe('rollback');
    expect(textes.some((t) => t.startsWith('insert'))).toBe(false);
  });

  it('traduit une violation d’unicité concurrente en refus clair', async () => {
    const violation = Object.assign(new Error('dup'), { code: '23505' });
    const bd = fauxExecuteur([['insert into tenant', violation]]);
    await expect(creerGarage(bd, entreeValide, hacher)).rejects.toMatchObject({
      code: 'GARAGE_EXISTANT',
    });
    expect(bd.appels.at(-1)?.texte).toBe('rollback');
  });

  it('ne met jamais le mot de passe en clair dans une requête', async () => {
    const bd = fauxExecuteur();
    await creerGarage(bd, entreeValide, hacher);
    expect(JSON.stringify(bd.appels)).not.toContain('"Correct-Horse-Battery-42"');
  });
});
