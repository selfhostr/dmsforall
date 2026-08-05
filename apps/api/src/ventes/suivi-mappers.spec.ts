import { describe, expect, it } from 'vitest';
import type { RoleUtilisateur } from '@dfa/shared';

import {
  ajouterJoursIso,
  calculerEcheanceFinancement,
  calculerEcheanceGarantie,
  calculerProchaineEcheance,
  construireSuiviGarantie,
  estDansFenetre,
  versLigneSuiviVente,
  versSuiviFinancement,
  type EntreeLigneSuiviVenteBrut,
  type EntreeSuiviFinancementBrut,
} from './suivi-mappers';

const MAINTENANT = new Date('2026-08-05T10:00:00.000Z');

/** `direction` voit les montants (`roleVoitLesMontants`), `technicien` n'en voit AUCUN
 *  (`ROLES_SANS_MONTANT`, même doctrine que `atelier/ligne.ts`/`facturation/mappeurs.ts`) — les
 *  deux rôles de référence utilisés dans toute la suite `mappers.spec.ts` de ce module. */
const ROLE_VOIT_MONTANTS: RoleUtilisateur = 'direction';
const ROLE_SANS_MONTANT: RoleUtilisateur = 'technicien';

/**
 * Cas limites jugés les plus à risque pour ce fichier (fonctions PURES, testées sans base — voir
 * l'en-tête de `suivi-mappers.ts`) :
 *  - RF-116 : `dureeMois`/`echeanceLe` du financement doivent être ABSENTS (pas `null`) du résultat
 *    pour un rôle sans droit aux montants — une seule assertion `toBeUndefined()` ne suffit pas à
 *    distinguer « absent » de « présent et undefined », d'où `'dureeMois' in financement`.
 *  - Échéance financement : jamais estimée hors `confirme` + les deux valeurs connues.
 *  - Garantie : jamais gatée par rôle (RF-116 ne s'applique qu'au financement).
 *  - `prochaineEcheanceLe` : dérivée UNIQUEMENT des champs visibles, jamais reconstituée depuis un
 *    champ omis par rôle (garde transitive documentée en tête de `contrats/ventes/suivi.ts`).
 */
describe('ajouterJoursIso', () => {
  it('traverse un changement de mois', () => {
    expect(ajouterJoursIso('2026-01-30', 5)).toBe('2026-02-04');
  });

  it('traverse une année bissextile (2028)', () => {
    expect(ajouterJoursIso('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('0 jour : identité', () => {
    expect(ajouterJoursIso('2026-08-05', 0)).toBe('2026-08-05');
  });
});

describe('calculerEcheanceFinancement', () => {
  it('`confirme` + `confirmeLe` + `dureeMois` tous connus : échéance calculée au jour près', () => {
    expect(calculerEcheanceFinancement('confirme', '2026-08-04T15:43:25.877Z', 48)).toBe(
      '2030-08-04',
    );
  });

  it('`en_attente` (pas encore confirmé) : jamais estimée, même avec confirmeLe/dureeMois présents', () => {
    expect(calculerEcheanceFinancement('en_attente', '2026-08-04T15:43:25.877Z', 48)).toBeNull();
  });

  it('`refuse` : jamais estimée', () => {
    expect(calculerEcheanceFinancement('refuse', '2026-08-04T15:43:25.877Z', 48)).toBeNull();
  });

  it('`confirme` mais `dureeMois` inconnue : null, pas de valeur inventée', () => {
    expect(calculerEcheanceFinancement('confirme', '2026-08-04T15:43:25.877Z', null)).toBeNull();
  });

  it('`confirme` mais `confirmeLe` inconnu (ne devrait pas arriver, défensif) : null', () => {
    expect(calculerEcheanceFinancement('confirme', null, 48)).toBeNull();
  });
});

describe('calculerEcheanceGarantie', () => {
  it('`debutLe` + `mois` connus : échéance calculée', () => {
    expect(calculerEcheanceGarantie('2026-01-15', 24)).toBe('2028-01-15');
  });

  it('`mois` inconnu : null, jamais une durée par défaut inventée', () => {
    expect(calculerEcheanceGarantie('2026-01-15', null)).toBeNull();
  });

  it('`debutLe` inconnu : null', () => {
    expect(calculerEcheanceGarantie(null, 24)).toBeNull();
  });
});

describe('calculerProchaineEcheance', () => {
  it('les deux connues : rend la plus proche (asc)', () => {
    expect(calculerProchaineEcheance('2030-08-04', '2027-01-15')).toBe('2027-01-15');
  });

  it('égalité : rend la valeur (peu importe laquelle, elles sont identiques)', () => {
    expect(calculerProchaineEcheance('2027-01-15', '2027-01-15')).toBe('2027-01-15');
  });

  it('une seule connue (financement `undefined`, RF-116 omis) : rend la garantie', () => {
    expect(calculerProchaineEcheance(undefined, '2027-01-15')).toBe('2027-01-15');
  });

  it('une seule connue (garantie `null`) : rend le financement', () => {
    expect(calculerProchaineEcheance('2030-08-04', null)).toBe('2030-08-04');
  });

  it('aucune connue : null', () => {
    expect(calculerProchaineEcheance(null, undefined)).toBeNull();
  });
});

describe('estDansFenetre', () => {
  const AUJOURDHUI = '2026-08-05';

  it('échéance = aujourd’hui + dansJours (borne haute INCLUSE)', () => {
    expect(estDansFenetre('2026-09-04', 30, AUJOURDHUI)).toBe(true);
  });

  it('échéance = aujourd’hui + dansJours + 1 jour : exclue', () => {
    expect(estDansFenetre('2026-09-05', 30, AUJOURDHUI)).toBe(false);
  });

  it('échéance = aujourd’hui (borne basse INCLUSE)', () => {
    expect(estDansFenetre(AUJOURDHUI, 30, AUJOURDHUI)).toBe(true);
  });

  it('échéance déjà dépassée (hier) : jamais « dans les prochains jours »', () => {
    expect(estDansFenetre('2026-08-04', 30, AUJOURDHUI)).toBe(false);
  });

  it('`echeanceLe` null (rien à suivre) : false', () => {
    expect(estDansFenetre(null, 30, AUJOURDHUI)).toBe(false);
  });
});

function financementBrutFixture(
  champs: Partial<EntreeSuiviFinancementBrut> = {},
): EntreeSuiviFinancementBrut {
  return {
    id: 'financement-1',
    type: 'leasing',
    statut: 'confirme',
    confirmeLe: '2026-08-04T15:43:25.877Z',
    dureeMois: 48,
    organismeId: 'organisme-1',
    organismeType: 'entreprise',
    organismeNom: null,
    organismePrenom: null,
    organismeRaisonSociale: 'AUDIT-Leasing SA',
    ...champs,
  };
}

describe('versSuiviFinancement — RF-116 (omission, pas `null`)', () => {
  it('aucun financement credit/leasing (jointure LATERAL vide, `id` null) : rend `null`', () => {
    expect(
      versSuiviFinancement(financementBrutFixture({ id: null }), ROLE_VOIT_MONTANTS),
    ).toBeNull();
  });

  it('rôle qui voit les montants : `dureeMois`/`echeanceLe` PRÉSENTS', () => {
    const resultat = versSuiviFinancement(financementBrutFixture(), ROLE_VOIT_MONTANTS);
    expect(resultat).not.toBeNull();
    expect('dureeMois' in (resultat as object)).toBe(true);
    expect('echeanceLe' in (resultat as object)).toBe(true);
    expect(resultat?.dureeMois).toBe(48);
    expect(resultat?.echeanceLe).toBe('2030-08-04');
  });

  it('rôle SANS droit aux montants : `dureeMois`/`echeanceLe` ABSENTS de l’objet (pas `undefined` en valeur, absents en clé — RF-116)', () => {
    const resultat = versSuiviFinancement(financementBrutFixture(), ROLE_SANS_MONTANT);
    expect(resultat).not.toBeNull();
    expect('dureeMois' in (resultat as object)).toBe(false);
    expect('echeanceLe' in (resultat as object)).toBe(false);
    // Le reste de la ligne (identité, statut, organisme) reste visible — seul le détail monétaire
    // et l'échéance qui en dérive sont gatés.
    expect(resultat?.id).toBe('financement-1');
    expect(resultat?.statutConfirmation).toBe('confirme');
    expect(resultat?.organisme).toEqual({ id: 'organisme-1', nomAffiche: 'AUDIT-Leasing SA' });
  });

  it('sans organisme enregistré (défensif, ne devrait pas arriver pour credit/leasing) : `organisme` null', () => {
    const resultat = versSuiviFinancement(
      financementBrutFixture({ organismeId: null }),
      ROLE_VOIT_MONTANTS,
    );
    expect(resultat?.organisme).toBeNull();
  });
});

describe('construireSuiviGarantie — jamais gatée par rôle', () => {
  it('`debutLe` absent : null (rien à suivre)', () => {
    expect(construireSuiviGarantie(null, 24, 100_000, 50_000, MAINTENANT)).toBeNull();
  });

  it('`mois` connu, plafond km non atteint, date non dépassée : `active = true`, `finLe` calculée', () => {
    const g = construireSuiviGarantie('2026-01-01', 36, 100_000, 10_000, MAINTENANT);
    expect(g).not.toBeNull();
    expect(g?.finLe).toBe('2029-01-01');
    expect(g?.active).toBe(true);
  });

  it('`mois` inconnu : `finLe` null, jamais une durée par défaut inventée', () => {
    const g = construireSuiviGarantie('2026-01-01', null, 100_000, 10_000, MAINTENANT);
    expect(g?.finLe).toBeNull();
  });

  it('kilométrage déjà au-delà du plafond : `active = false`', () => {
    const g = construireSuiviGarantie('2020-01-01', 36, 100_000, 150_000, MAINTENANT);
    expect(g?.active).toBe(false);
  });
});

function ligneBrutFixture(
  champs: Partial<EntreeLigneSuiviVenteBrut> = {},
): EntreeLigneSuiviVenteBrut {
  return {
    dossierVenteId: 'dossier-1',
    siteId: 'site-1',
    dossierStatut: 'livre',
    clientAcheteurId: 'client-1',
    clientAcheteurType: 'particulier',
    clientAcheteurNom: 'Dupont',
    clientAcheteurPrenom: 'Jean',
    clientAcheteurRaisonSociale: null,
    vehiculeId: 'vehicule-1',
    vehiculeMarque: 'Toyota',
    vehiculeModele: 'Yaris',
    vehiculeVersion: null,
    vehiculeVin: 'VIN123',
    garantieDebut: null,
    garantieMois: null,
    garantieKm: null,
    dernierKilometrageKm: null,
    financement: financementBrutFixture({ id: null }),
    ...champs,
  };
}

describe('versLigneSuiviVente — assemblage complet', () => {
  it('financement seul (pas de garantie) : `prochaineEcheanceLe` = échéance du financement', () => {
    const ligne = versLigneSuiviVente(
      ligneBrutFixture({ financement: financementBrutFixture() }),
      ROLE_VOIT_MONTANTS,
      MAINTENANT,
    );
    expect(ligne.garantie).toBeNull();
    expect(ligne.prochaineEcheanceLe).toBe('2030-08-04');
  });

  it('garantie seule (pas de financement) : `prochaineEcheanceLe` = fin de garantie', () => {
    const ligne = versLigneSuiviVente(
      ligneBrutFixture({ garantieDebut: '2026-01-01', garantieMois: 24 }),
      ROLE_VOIT_MONTANTS,
      MAINTENANT,
    );
    expect(ligne.financement).toBeNull();
    expect(ligne.prochaineEcheanceLe).toBe('2028-01-01');
  });

  it('les deux présentes : `prochaineEcheanceLe` = la plus proche des deux', () => {
    const ligne = versLigneSuiviVente(
      ligneBrutFixture({
        garantieDebut: '2026-01-01',
        garantieMois: 6, // échéance 2026-07-01, plus proche que le financement (2030-08-04)
        financement: financementBrutFixture(),
      }),
      ROLE_VOIT_MONTANTS,
      MAINTENANT,
    );
    expect(ligne.prochaineEcheanceLe).toBe('2026-07-01');
  });

  it('RF-116 transitive : rôle sans montant, `prochaineEcheanceLe` ne peut JAMAIS dériver de l’échéance financement masquée', () => {
    // Financement confirmé à échéance TRÈS proche (2026-08-06) — si `prochaineEcheanceLe` la
    // laissait fuiter malgré l'omission de `echeanceLe`, ce test la verrait apparaître ici.
    const ligne = versLigneSuiviVente(
      ligneBrutFixture({
        financement: financementBrutFixture({
          confirmeLe: '2026-08-05T00:00:00.000Z',
          dureeMois: 0, // échéance quasi immédiate si elle fuitait
        }),
      }),
      ROLE_SANS_MONTANT,
      MAINTENANT,
    );
    expect('echeanceLe' in (ligne.financement as object)).toBe(false);
    expect(ligne.prochaineEcheanceLe).toBeNull();
  });

  it('ni financement ni garantie : `prochaineEcheanceLe` null', () => {
    const ligne = versLigneSuiviVente(ligneBrutFixture(), ROLE_VOIT_MONTANTS, MAINTENANT);
    expect(ligne.financement).toBeNull();
    expect(ligne.garantie).toBeNull();
    expect(ligne.prochaineEcheanceLe).toBeNull();
  });

  it('pas de véhicule associé (dossier en prospection) : `vehicule` null', () => {
    const ligne = versLigneSuiviVente(
      ligneBrutFixture({ vehiculeId: null }),
      ROLE_VOIT_MONTANTS,
      MAINTENANT,
    );
    expect(ligne.vehicule).toBeNull();
  });
});
