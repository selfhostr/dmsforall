import { describe, expect, it } from 'vitest';

import type { ReponseBlocCreancier, ReponseMotifRendezVous, UtilisateurResume } from '@dfa/shared';

import {
  calculerEtapesDemarrage,
  demarrageComplet,
  type DonneesDemarrage,
} from './etapes-demarrage';

const CREANCIER_COMPLET: ReponseBlocCreancier = {
  nom: 'Garage Martin SA',
  rue: 'Rue de la Gare',
  numero: '12',
  npa: '1000',
  localite: 'Lausanne',
  pays: 'CH',
  iban: 'CH9300762011623852957',
  qrIban: null,
  version: 1,
};

const motif = (actif: boolean): ReponseMotifRendezVous => ({
  id: 'm1',
  code: 'REVISION',
  libelleFr: 'Révision',
  libelleDe: null,
  libelleIt: null,
  dureeDefautMinutes: 60,
  heuresAtelierDefautCentiemes: null,
  actif,
});

const utilisateur = (id: string): UtilisateurResume => ({
  id,
  prenom: 'A',
  nom: 'B',
  email: 'a@b.ch',
  role: 'technicien',
  statut: 'actif',
  sites: [],
  derniereConnexionLe: null,
  creeLe: '2026-01-01T00:00:00.000Z',
});

const TOUT_FAIT: DonneesDemarrage = {
  creancier: CREANCIER_COMPLET,
  numeroTva: 'CHE-116.281.710 TVA',
  nbTauxHoraires: 1,
  motifs: [motif(true)],
  utilisateurs: [utilisateur('moi'), utilisateur('paul')],
  nbBornes: 0,
  utilisateurCourantId: 'moi',
};

const etat = (donnees: DonneesDemarrage, id: string) =>
  calculerEtapesDemarrage(donnees).find((e) => e.id === id)?.etat;

describe('calculerEtapesDemarrage', () => {
  it('garage neuf : tout est à faire, rien n’est inventé comme fait', () => {
    const etapes = calculerEtapesDemarrage({
      creancier: {
        ...CREANCIER_COMPLET,
        nom: null,
        rue: null,
        npa: null,
        localite: null,
        iban: null,
      },
      numeroTva: null,
      nbTauxHoraires: 0,
      motifs: [],
      utilisateurs: [utilisateur('moi')],
      nbBornes: 0,
      utilisateurCourantId: 'moi',
    });
    expect(etapes.map((e) => e.etat)).toEqual(Array(7).fill('aFaire'));
    expect(demarrageComplet(etapes)).toBe(false);
  });

  it('tout réglé sauf la borne (facultative) : complet', () => {
    const etapes = calculerEtapesDemarrage(TOUT_FAIT);
    expect(etapes.find((e) => e.id === 'borne')?.etat).toBe('aFaire');
    expect(demarrageComplet(etapes)).toBe(true);
  });

  it('une adresse incomplète laisse « coordonnées » à faire mais « compte » fait', () => {
    const donnees = { ...TOUT_FAIT, creancier: { ...CREANCIER_COMPLET, npa: '' } };
    expect(etat(donnees, 'coordonnees')).toBe('aFaire');
    expect(etat(donnees, 'compte')).toBe('fait');
  });

  it('un QR-IBAN seul suffit pour le compte', () => {
    const donnees = {
      ...TOUT_FAIT,
      creancier: { ...CREANCIER_COMPLET, iban: null, qrIban: 'CH4431999123000889012' },
    };
    expect(etat(donnees, 'compte')).toBe('fait');
  });

  it('seuls des motifs désactivés comptent pour rien', () => {
    expect(etat({ ...TOUT_FAIT, motifs: [motif(false)] }, 'motifs')).toBe('aFaire');
  });

  it('le compte connecté ne compte pas comme « premier collaborateur »', () => {
    expect(etat({ ...TOUT_FAIT, utilisateurs: [utilisateur('moi')] }, 'collaborateur')).toBe(
      'aFaire',
    );
  });

  it('source non lue : « inconnu », jamais « à faire », et la liste n’est pas complète', () => {
    const donnees = { ...TOUT_FAIT, creancier: undefined, numeroTva: undefined };
    const etapes = calculerEtapesDemarrage(donnees);
    expect(etat(donnees, 'coordonnees')).toBe('inconnu');
    expect(etat(donnees, 'compte')).toBe('inconnu');
    expect(etat(donnees, 'tva')).toBe('inconnu');
    expect(demarrageComplet(etapes)).toBe(false);
  });
});
