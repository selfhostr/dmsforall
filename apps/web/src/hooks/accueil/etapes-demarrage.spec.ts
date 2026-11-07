import { describe, expect, it } from 'vitest';

import type { ReponseEtatDemarrage } from '@dfa/shared';

import { calculerEtapesDemarrage, demarrageComplet } from './etapes-demarrage';

const TOUT_FAIT: ReponseEtatDemarrage = {
  etapes: {
    coordonnees: true,
    iban: true,
    numeroTva: true,
    tauxHoraire: true,
    motifsRdv: true,
    premierCollaborateur: true,
    borne: false,
  },
};

const etat = (reponse: ReponseEtatDemarrage | undefined, id: string) =>
  calculerEtapesDemarrage(reponse).find((e) => e.id === id)?.etat;

describe('calculerEtapesDemarrage', () => {
  it('garage neuf : tout est à faire, rien n’est inventé comme fait', () => {
    const etapes = calculerEtapesDemarrage({
      etapes: {
        coordonnees: false,
        iban: false,
        numeroTva: false,
        tauxHoraire: false,
        motifsRdv: false,
        premierCollaborateur: false,
        borne: false,
      },
    });
    expect(etapes.map((e) => e.etat)).toEqual(Array(7).fill('aFaire'));
    expect(demarrageComplet(etapes)).toBe(false);
  });

  it('tout réglé sauf la borne (facultative) : complet', () => {
    const etapes = calculerEtapesDemarrage(TOUT_FAIT);
    expect(etapes.find((e) => e.id === 'borne')?.etat).toBe('aFaire');
    expect(demarrageComplet(etapes)).toBe(true);
  });

  it('chaque étape suit sa propre clé serveur', () => {
    const reponse = { etapes: { ...TOUT_FAIT.etapes, iban: false, motifsRdv: false } };
    expect(etat(reponse, 'compte')).toBe('aFaire');
    expect(etat(reponse, 'motifs')).toBe('aFaire');
    expect(etat(reponse, 'coordonnees')).toBe('fait');
    expect(etat(reponse, 'collaborateur')).toBe('fait');
  });

  it('réponse absente : « inconnu », jamais « à faire », et la liste n’est pas complète', () => {
    const etapes = calculerEtapesDemarrage(undefined);
    expect(etapes.map((e) => e.etat)).toEqual(Array(7).fill('inconnu'));
    expect(demarrageComplet(etapes)).toBe(false);
  });
});
