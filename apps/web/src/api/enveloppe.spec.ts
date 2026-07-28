import { describe, expect, it } from 'vitest';

import type { Avertissement, PageCurseur, ReponseAvecAvertissements } from '@dfa/shared';

import { avertissementsDe, donneesEcriture, donneesPage, estDernierePage } from './enveloppe';

describe('avertissementsDe / donneesEcriture', () => {
  it('extrait donnees et avertissements sans les confondre avec une erreur', () => {
    const avertissement: Avertissement = {
      code: 'CLIENT_DOUBLON_PROBABLE',
      message: 'Doublon probable',
      donnees: { candidats: [] },
    };
    const reponse: ReponseAvecAvertissements<{ id: string }> = {
      donnees: { id: 'client-1' },
      avertissements: [avertissement],
    };

    expect(donneesEcriture(reponse)).toEqual({ id: 'client-1' });
    expect(avertissementsDe(reponse)).toEqual([avertissement]);
  });

  it('renvoie un tableau vide (jamais undefined) quand le contrat ne porte aucun avertissement', () => {
    const reponse: ReponseAvecAvertissements<{ id: string }> = { donnees: { id: 'client-1' }, avertissements: [] };
    expect(avertissementsDe(reponse)).toEqual([]);
  });
});

describe('donneesPage / estDernierePage', () => {
  it('extrait le tableau donnees d’une page', () => {
    const page: PageCurseur<{ id: string }> = { donnees: [{ id: 'a' }, { id: 'b' }], curseurSuivant: null, limite: 50 };
    expect(donneesPage(page)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('estDernierePage est vrai uniquement quand curseurSuivant est null', () => {
    const derniere: PageCurseur<{ id: string }> = { donnees: [], curseurSuivant: null, limite: 50 };
    const intermediaire: PageCurseur<{ id: string }> = { donnees: [], curseurSuivant: 'abc123', limite: 50 };
    expect(estDernierePage(derniere)).toBe(true);
    expect(estDernierePage(intermediaire)).toBe(false);
  });
});
