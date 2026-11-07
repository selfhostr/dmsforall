import { describe, expect, it } from 'vitest';

import { MODULES_APP, modulesActifsDepuis, type ModuleApp, type ReponseEtatDemarrage } from '@dfa/shared';

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

  it('garage non assujetti (n° TVA absent) : complet, le n° TVA est facultatif', () => {
    const etapes = calculerEtapesDemarrage({
      etapes: { ...TOUT_FAIT.etapes, numeroTva: false },
    });
    expect(etapes.find((e) => e.id === 'tva')).toMatchObject({ etat: 'aFaire', facultative: true });
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

describe('calculerEtapesDemarrage — modules retirés', () => {
  const ids = (modulesActifs?: readonly ModuleApp[]) =>
    calculerEtapesDemarrage(TOUT_FAIT, modulesActifs).map((e) => e.id);

  it('sans liste de modules : les sept étapes', () => {
    expect(ids(undefined)).toHaveLength(7);
    expect(ids([...MODULES_APP])).toHaveLength(7);
  });

  it('atelier retiré : plus d’étape « taux horaire »', () => {
    expect(ids(modulesActifsDepuis(['atelier']))).not.toContain('tauxHoraire');
  });

  it('planning retiré : plus d’étape « motifs de rendez-vous »', () => {
    expect(ids(modulesActifsDepuis(['planning']))).not.toContain('motifs');
  });

  it('tablettes retirées : plus d’étape « borne » ; le socle (coordonnées, compte, équipe) reste', () => {
    const restantes = ids(modulesActifsDepuis(['tablettes']));
    expect(restantes).not.toContain('borne');
    expect(restantes).toEqual(
      expect.arrayContaining(['coordonnees', 'compte', 'tva', 'collaborateur']),
    );
  });

  it('un module retiré ne bloque pas « complet » : la liste se retire seule', () => {
    const etapes = calculerEtapesDemarrage(
      { etapes: { ...TOUT_FAIT.etapes, tauxHoraire: false } },
      modulesActifsDepuis(['atelier']),
    );
    expect(demarrageComplet(etapes)).toBe(true);
  });
});

