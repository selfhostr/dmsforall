import { describe, expect, it } from 'vitest';

import {
  STATUTS_COMMANDE_FOURNISSEUR,
  STATUTS_DEPOT_PNEUS,
  STATUTS_DOSSIER_VENTE,
} from '@dfa/shared';

import {
  commandeFournisseurReprise,
  depotPneusRepris,
  dossierVenteRepris,
} from './criteres-perimetre-reprise';

/**
 * EXHAUSTIF sur chaque énumération de statut réelle (`STATUTS_*` de `@dfa/shared`), pas seulement
 * sur les valeurs « en cours » — un statut oublié dans le prédicat resterait invisible à un test
 * qui ne couvrirait que le chemin heureux. Toute valeur AJOUTÉE plus tard à ces énumérations fait
 * grandir les tableaux `STATUTS_*` importés directement (source unique), donc ce test reste
 * exhaustif sans entretien manuel.
 */

describe('depotPneusRepris — D-41, dépôts pneus en cours uniquement', () => {
  it('en_depot et monte sont repris (littéral de la décision)', () => {
    expect(depotPneusRepris('en_depot')).toBe(true);
    expect(depotPneusRepris('monte')).toBe(true);
  });

  it('sorti (dépôt déjà rendu/vendu/rebut) — jamais repris (D-41)', () => {
    expect(depotPneusRepris('sorti')).toBe(false);
  });

  it('a_relancer — exclu (ambiguïté signalée en commentaire : jamais un statut source de toute façon)', () => {
    expect(depotPneusRepris('a_relancer')).toBe(false);
  });

  it('couvre EXACTEMENT STATUTS_DEPOT_PNEUS, aucun statut oublié ni halluciné', () => {
    const attendu = { en_depot: true, monte: true, a_relancer: false, sorti: false };
    for (const statut of STATUTS_DEPOT_PNEUS) {
      expect(depotPneusRepris(statut)).toBe(attendu[statut]);
    }
    expect(STATUTS_DEPOT_PNEUS).toHaveLength(Object.keys(attendu).length);
  });
});

describe('commandeFournisseurReprise — D-40, commandes fournisseur non soldées uniquement', () => {
  it('brouillon, envoyee, partiellement_recue sont reprises (littéral de la décision)', () => {
    expect(commandeFournisseurReprise('brouillon')).toBe(true);
    expect(commandeFournisseurReprise('envoyee')).toBe(true);
    expect(commandeFournisseurReprise('partiellement_recue')).toBe(true);
  });

  it('recue et cloturee — soldées, archive froide (D-15), jamais reprises', () => {
    expect(commandeFournisseurReprise('recue')).toBe(false);
    expect(commandeFournisseurReprise('cloturee')).toBe(false);
  });

  it('annulee — exclue (rien à réapprovisionner, absente du littéral D-40)', () => {
    expect(commandeFournisseurReprise('annulee')).toBe(false);
  });

  it('couvre EXACTEMENT STATUTS_COMMANDE_FOURNISSEUR, aucun statut oublié ni halluciné', () => {
    const attendu = {
      brouillon: true,
      envoyee: true,
      partiellement_recue: true,
      recue: false,
      cloturee: false,
      annulee: false,
    };
    for (const statut of STATUTS_COMMANDE_FOURNISSEUR) {
      expect(commandeFournisseurReprise(statut)).toBe(attendu[statut]);
    }
    expect(STATUTS_COMMANDE_FOURNISSEUR).toHaveLength(Object.keys(attendu).length);
  });
});

describe('dossierVenteRepris — D-42, dossiers de vente ouverts uniquement', () => {
  it('prospection, engage, en_preparation, pret_a_livrer sont repris', () => {
    expect(dossierVenteRepris('prospection')).toBe(true);
    expect(dossierVenteRepris('engage')).toBe(true);
    expect(dossierVenteRepris('en_preparation')).toBe(true);
    expect(dossierVenteRepris('pret_a_livrer')).toBe(true);
  });

  it('livre, clos, annule, abandonne — jamais repris (littéral exact de D-42)', () => {
    expect(dossierVenteRepris('livre')).toBe(false);
    expect(dossierVenteRepris('clos')).toBe(false);
    expect(dossierVenteRepris('annule')).toBe(false);
    expect(dossierVenteRepris('abandonne')).toBe(false);
  });

  it('couvre EXACTEMENT STATUTS_DOSSIER_VENTE, aucun statut oublié ni halluciné', () => {
    const attendu = {
      prospection: true,
      engage: true,
      en_preparation: true,
      pret_a_livrer: true,
      livre: false,
      clos: false,
      annule: false,
      abandonne: false,
    };
    for (const statut of STATUTS_DOSSIER_VENTE) {
      expect(dossierVenteRepris(statut)).toBe(attendu[statut]);
    }
    expect(STATUTS_DOSSIER_VENTE).toHaveLength(Object.keys(attendu).length);
  });
});
