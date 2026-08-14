import { describe, expect, it } from 'vitest';
import type { ClientResume, RepriseResume, RoleUtilisateur } from '@dfa/shared';

import type { LigneDocumentVente, LigneDossierVente, LigneFinancementVente } from '../db/schema';

import {
  calculerActionsDisponiblesVehiculeStock,
  calculerEcartRepriseVehicule,
  calculerJoursStock,
  roleVoitFinancement,
  roleVoitReprise,
  versDocumentVenteResume,
  versDossierVenteResponse,
  versFinancementResponse,
  versFinancementResume,
  type EntreeMapperDossierVente,
} from './mappers';

/**
 * Cas limites de `mappers.ts` jugés les plus à risque pour cette livraison :
 *  - `calculerActionsDisponiblesVehiculeStock` — la matrice rôle × action pour `marquer_vendu`
 *    (trou n°2 comblé, voir `service-vehicule-stock.ts::marquerVendu`) : n'apparaît QUE depuis
 *    `reserve`, ET seulement pour un rôle qui détient `ventes.vehicule_stock.corriger` (`direction`,
 *    pas `vendeur`, `matrice-droits.ts`) — même garde que `remettre_disponible`, la correction
 *    exceptionnelle n'est pas un geste comptoir ;
 *  - `calculerEcartRepriseVehicule` — arithmétique argent (centimes, jamais de float) : positif
 *    (reprise gonflée, RV-20), négatif (RV-27), et `null` tant que non négociée ;
 *  - `calculerJoursStock` — dérivé depuis `dateEntreeStock`/`venduLe`, jamais négatif même sur une
 *    entrée du jour même.
 */
describe('calculerActionsDisponiblesVehiculeStock — marquer_vendu (trou n°2 comblé)', () => {
  it('`reserve` + rôle avec `ventes.vehicule_stock.corriger` (direction) : marquer_vendu ET remettre_disponible disponibles', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('reserve', 'direction');
    expect(actions).toContain('marquer_vendu');
    expect(actions).toContain('remettre_disponible');
  });

  it('`reserve` + rôle SANS `ventes.vehicule_stock.corriger` (vendeur) : ni marquer_vendu ni remettre_disponible', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('reserve', 'vendeur');
    expect(actions).not.toContain('marquer_vendu');
    expect(actions).not.toContain('remettre_disponible');
  });

  it('`vendu` : verrouillé, marquer_vendu ne réapparaît pas même pour direction (transition déjà consommée)', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('vendu', 'direction');
    expect(actions).toHaveLength(0);
  });

  it('`disponible` : marquer_vendu absent (transition `reserve -> vendu` uniquement, pas `disponible -> vendu`)', () => {
    const actions = calculerActionsDisponiblesVehiculeStock('disponible', 'direction');
    expect(actions).not.toContain('marquer_vendu');
  });
});

describe('calculerEcartRepriseVehicule — RV-20/RV-21, argent en centimes, jamais de float', () => {
  it('`null` tant que non négociée', () => {
    expect(calculerEcartRepriseVehicule(800_000, null)).toBeNull();
  });

  it('positif : reprise gonflée (RV-20), remise déguisée sur le neuf', () => {
    expect(calculerEcartRepriseVehicule(800_000, 850_000)).toBe(50_000);
  });

  it('négatif : reprise revue à la baisse après expertise physique (RV-27)', () => {
    expect(calculerEcartRepriseVehicule(800_000, 720_000)).toBe(-80_000);
  });

  it('zéro : valeur négociée strictement égale à l’estimation', () => {
    expect(calculerEcartRepriseVehicule(800_000, 800_000)).toBe(0);
  });
});

describe('calculerJoursStock — RV-07, dérivé, jamais négatif', () => {
  it('toujours en stock (venduLe null) : jours écoulés jusqu’à `maintenant`', () => {
    const jours = calculerJoursStock('2026-07-01', null, new Date('2026-07-31T00:00:00.000Z'));
    expect(jours).toBe(30);
  });

  it('vendu : jours écoulés jusqu’à `venduLe`, PAS jusqu’à `maintenant` (un véhicule vendu il y a un mois ne vieillit plus au compteur)', () => {
    const jours = calculerJoursStock(
      '2026-07-01',
      new Date('2026-07-11T00:00:00.000Z'),
      new Date('2026-07-31T00:00:00.000Z'),
    );
    expect(jours).toBe(10);
  });

  it('entrée du jour même : 0, jamais négatif', () => {
    const jours = calculerJoursStock('2026-07-31', null, new Date('2026-07-31T08:00:00.000Z'));
    expect(jours).toBe(0);
  });
});

/**
 * Trou comblé (audit préalable, migration 0042) : `financement_vente` n'exposait aucune donnée
 * monétaire (`montantFinanceCentimes`/`acompteCentimes`/`mensualiteCentimes`/
 * `tauxInteretPourmille`/`dureeMois`). Ces tests prouvent que `versFinancementResponse` et
 * `versFinancementResume` (1) exposent bien les cinq champs quand le rôle voit les montants, et
 * (2) les OMETTENT (pas `null` — absents de l'objet) pour un rôle qui n'en a pas le droit — même
 * doctrine que `versDocumentVenteResume` (RF-116) déjà exercée par ce module.
 */
function ligneFinancementFixture(
  champs: Partial<LigneFinancementVente> = {},
): LigneFinancementVente {
  return {
    id: 'fin-1',
    tenantId: 'tid-1',
    dossierVenteId: 'dossier-1',
    type: 'leasing',
    organismeId: 'organisme-1',
    referenceContrat: 'LSG-2026-042',
    montantFinanceCentimes: 2_500_000,
    acompteCentimes: 300_000,
    mensualiteCentimes: 45_000,
    tauxInteretPourmille: 39,
    dureeMois: 48,
    statut: 'en_attente',
    confirmeLe: null,
    refuseLe: null,
    motifRefus: null,
    version: 1,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
    modifieLe: new Date('2026-08-01T08:00:00.000Z'),
    ...champs,
  } as LigneFinancementVente;
}

/**
 * #127 : « Montant TTC 0.00 » sur la carte Documents d'un dossier pour un bon de commande dont le
 * montant réel était CHF 41'900.00. `versDocumentVenteResume` ne lit PLUS `doc.totalTtcCentimes`
 * directement — l'appelant (`totauxTtcAffichesDocumentsDossier`, `references.ts`) fournit la valeur
 * à AFFICHER en 3ᵉ argument (recalculée pour un `brouillon`, lue telle quelle sinon). Ce mapper
 * n'était couvert par AUCUN test avant ce correctif (⚠️ codegraph).
 */
function documentVenteFixture(champs: Partial<LigneDocumentVente> = {}): LigneDocumentVente {
  return {
    id: 'doc-1',
    typeDocument: 'bon_commande',
    natureFacture: 'ordinaire',
    numero: 'BC-2026-042',
    statut: 'brouillon',
    statutReglement: 'non_regle',
    clientId: 'client-1',
    clientDesignationFigee: 'Jean Dupont',
    dateDocument: '2026-08-01',
    devise: 'CHF',
    totalTtcCentimes: 0n,
    soldeCentimes: 0n,
    ...champs,
  } as LigneDocumentVente;
}

describe('versDocumentVenteResume — #127, totalTtcCentimes NE VIENT PLUS de doc.totalTtcCentimes', () => {
  it.each<RoleUtilisateur>(['direction', 'vendeur', 'comptable'])(
    'rôle %s (voit les montants) : totalTtcCentimes = la valeur AFFICHÉE passée par l’appelant, pas la colonne stockée',
    (role) => {
      // La colonne stockée est à 0 (cas brouillon réel, MD-45) — si le mapper la lisait encore
      // directement, ce test échouerait avec 0 au lieu de 4189000.
      const doc = documentVenteFixture({ totalTtcCentimes: 0n });

      const resume = versDocumentVenteResume(doc, role, 4_189_000);

      expect(resume.totalTtcCentimes).toBe(4_189_000);
      expect(resume.soldeCentimes).toBe(0); // solde : colonne stockée, correcte à 0 pour un brouillon
    },
  );

  it.each<RoleUtilisateur>(['technicien', 'poste_atelier', 'admin'])(
    'rôle %s (masqué, RF-116) : totalTtcCentimes/soldeCentimes/statutReglement absents (pas null)',
    (role) => {
      const doc = documentVenteFixture({ totalTtcCentimes: 0n });

      const resume = versDocumentVenteResume(doc, role, 4_189_000);

      expect('totalTtcCentimes' in resume).toBe(false);
      expect('soldeCentimes' in resume).toBe(false);
      expect('statutReglement' in resume).toBe(false);
    },
  );

  it('un document ÉMIS reçoit aussi la valeur AFFICHÉE passée par l’appelant (lue depuis la colonne stockée en amont, MD-45)', () => {
    const facture = documentVenteFixture({
      typeDocument: 'facture',
      statut: 'emis',
      totalTtcCentimes: 4_189_000n,
      soldeCentimes: 4_189_000n,
    });

    const resume = versDocumentVenteResume(facture, 'direction', 4_189_000);

    expect(resume.totalTtcCentimes).toBe(4_189_000);
    expect(resume.soldeCentimes).toBe(4_189_000);
  });
});

describe('versFinancementResponse — détail monétaire (0042), visibilité par rôle (RF-116)', () => {
  it.each<RoleUtilisateur>(['direction', 'vendeur', 'comptable'])(
    'rôle %s (voit les montants) : les cinq champs sont exposés tels quels',
    (role) => {
      const reponse = versFinancementResponse(ligneFinancementFixture(), null, role);
      expect(reponse.montantFinanceCentimes).toBe(2_500_000);
      expect(reponse.acompteCentimes).toBe(300_000);
      expect(reponse.mensualiteCentimes).toBe(45_000);
      expect(reponse.tauxInteretPourmille).toBe(39);
      expect(reponse.dureeMois).toBe(48);
    },
  );

  it.each<RoleUtilisateur>(['technicien', 'admin'])(
    'rôle %s (ne voit pas les montants) : les cinq champs sont OMIS, pas à `null`',
    (role) => {
      const reponse = versFinancementResponse(ligneFinancementFixture(), null, role);
      expect('montantFinanceCentimes' in reponse).toBe(false);
      expect('acompteCentimes' in reponse).toBe(false);
      expect('mensualiteCentimes' in reponse).toBe(false);
      expect('tauxInteretPourmille' in reponse).toBe(false);
      expect('dureeMois' in reponse).toBe(false);
    },
  );

  it('une colonne réellement NULL (jamais saisie) reste `null` pour un rôle qui voit les montants — ne se confond pas avec une omission', () => {
    const reponse = versFinancementResponse(
      ligneFinancementFixture({ montantFinanceCentimes: null }),
      null,
      'direction',
    );
    expect('montantFinanceCentimes' in reponse).toBe(true);
    expect(reponse.montantFinanceCentimes).toBeNull();
  });
});

describe('versFinancementResume — même doctrine d’omission que versFinancementResponse (0042)', () => {
  it('rôle qui voit les montants : les cinq champs sont exposés dans le résumé embarqué', () => {
    const resume = versFinancementResume(ligneFinancementFixture(), null, 'direction');
    expect(resume).toMatchObject({
      montantFinanceCentimes: 2_500_000,
      acompteCentimes: 300_000,
      mensualiteCentimes: 45_000,
      tauxInteretPourmille: 39,
      dureeMois: 48,
    });
  });

  it('rôle sans droit sur les montants : omis du résumé embarqué (dossier-vente.ts::ReponseDossierVente.financement)', () => {
    const resume = versFinancementResume(ligneFinancementFixture(), null, 'technicien');
    expect('montantFinanceCentimes' in resume).toBe(false);
    expect('mensualiteCentimes' in resume).toBe(false);
  });
});

/**
 * FAILLE CORRIGÉE (audit sécurité) : `GET /dossiers-vente/{id}` n'était protégé QUE par
 * `ventes.dossier.lire` et embarquait TOUJOURS `reprise`/`financement(s)` en entier, sans jamais
 * vérifier `ventes.reprise.lire`/`ventes.financement.lire` — un `chef_atelier` (qui détient le
 * premier droit mais explicitement PAS les deux seconds, `auth/matrice-droits.ts::
 * DROITS_VENTES_PAR_ROLE.chef_atelier`) recevait `valeurNegocieeCentimes`,
 * `detteFinancementResiduelleCentimes`, `motifRefus`, `montantFinanceCentimes`,
 * `tauxInteretPourmille` en clair dans le corps JSON — masqué seulement côté écran. Ces tests
 * prouvent : (1) `roleVoitReprise`/`roleVoitFinancement` lisent bien `MATRICE_DROITS`, la SEULE
 * source de vérité de l'autorisation ; (2) `versDossierVenteResponse` OMET les clés
 * `reprise`/`financement`/`financements`/`financementsTronques` (pas `null` — absentes de l'objet)
 * quand l'appelant (`ServiceDossierVente.assembler`) lui passe `undefined`, et les expose telles
 * quelles sinon.
 */
describe('roleVoitReprise / roleVoitFinancement — lisent MATRICE_DROITS, pas roleVoitLesMontants', () => {
  it.each<RoleUtilisateur>(['direction', 'comptable', 'vendeur', 'receptionnaire'])(
    'rôle %s : détient ventes.reprise.lire ET ventes.financement.lire',
    (role) => {
      expect(roleVoitReprise(role)).toBe(true);
      expect(roleVoitFinancement(role)).toBe(true);
    },
  );

  it('chef_atelier : détient ventes.dossier.lire mais NI ventes.reprise.lire NI ventes.financement.lire — le cas exact de la faille', () => {
    expect(roleVoitReprise('chef_atelier')).toBe(false);
    expect(roleVoitFinancement('chef_atelier')).toBe(false);
  });

  it.each<RoleUtilisateur>(['technicien', 'magasinier', 'admin', 'poste_atelier'])(
    'rôle %s : ni l’un ni l’autre (aucun droit ventes.* pour ce domaine)',
    (role) => {
      expect(roleVoitReprise(role)).toBe(false);
      expect(roleVoitFinancement(role)).toBe(false);
    },
  );
});

const CLIENT_RESUME_FIXTURE: ClientResume = {
  id: 'client-acheteur-1',
  type: 'particulier',
  nomAffiche: 'Jean Dupont',
  telephone: null,
  email: null,
  bloque: false,
} as unknown as ClientResume;

const REPRISE_RESUME_FIXTURE: RepriseResume = {
  id: 'reprise-1',
  vehiculeRepris: { id: 'veh-repris-1' } as never,
  statut: 'negociee',
  valeurEstimeeCentimes: 800_000,
  valeurNegocieeCentimes: 850_000,
  ecartRepriseVehiculeCentimes: 50_000,
};

function dossierVenteLigneFixture(): LigneDossierVente {
  return {
    id: 'dossier-1',
    tenantId: 'tid-1',
    siteId: 'site-1',
    statut: 'engage',
    vehiculeId: null,
    clientAcheteurId: 'client-acheteur-1',
    clientFactureId: null,
    clientConducteurId: null,
    dateLivraisonEstimee: null,
    dateLivraisonEffective: null,
    identitePieceType: null,
    identiteVerifieeLe: null,
    engageLe: new Date('2026-07-20T09:00:00.000Z'),
    enPreparationLe: null,
    pretALivrerLe: null,
    livreLe: null,
    closLe: null,
    annuleLe: null,
    abandonneLe: null,
    motifCloture: null,
    version: 2,
    creeLe: new Date('2026-07-15T08:00:00.000Z'),
    modifieLe: new Date('2026-07-20T09:00:00.000Z'),
  } as LigneDossierVente;
}

/** Entrée minimale, `reprise`/`financement(s)` volontairement `undefined` par défaut — c'est ce que
 *  `ServiceDossierVente.assembler` transmet désormais pour un rôle sans le droit correspondant. */
function entreeMapperFixture(
  champs: Partial<EntreeMapperDossierVente> = {},
): EntreeMapperDossierVente {
  return {
    ligne: dossierVenteLigneFixture(),
    vehicule: null,
    typeVehicule: null,
    clientAcheteur: CLIENT_RESUME_FIXTURE,
    clientFacture: CLIENT_RESUME_FIXTURE,
    clientConducteur: null,
    reprise: undefined,
    financement: undefined,
    financements: undefined,
    financementsTronques: undefined,
    garantie: null,
    documents: [],
    documentsTronques: false,
    documentsRequis: [],
    role: 'chef_atelier',
    modifiePar: null,
    ...champs,
  };
}

describe('versDossierVenteResponse — omission complète de reprise/financement(s) par rôle (FAILLE CORRIGÉE)', () => {
  it('entrée `undefined` (rôle sans le droit) : les quatre clés sont ABSENTES de la réponse, pas `null`', () => {
    const reponse = versDossierVenteResponse(entreeMapperFixture());
    expect('reprise' in reponse).toBe(false);
    expect('financement' in reponse).toBe(false);
    expect('financements' in reponse).toBe(false);
    expect('financementsTronques' in reponse).toBe(false);
  });

  it('entrée renseignée (rôle autorisé) : les quatre clés sont PRÉSENTES, avec leurs valeurs exactes', () => {
    const reponse = versDossierVenteResponse(
      entreeMapperFixture({
        role: 'direction',
        reprise: REPRISE_RESUME_FIXTURE,
        financement: null,
        financements: [],
        financementsTronques: false,
      }),
    );
    expect('reprise' in reponse).toBe(true);
    expect(reponse.reprise).toEqual(REPRISE_RESUME_FIXTURE);
    expect('financement' in reponse).toBe(true);
    expect(reponse.financement).toBeNull();
    expect('financements' in reponse).toBe(true);
    expect(reponse.financements).toEqual([]);
    expect('financementsTronques' in reponse).toBe(true);
    expect(reponse.financementsTronques).toBe(false);
  });

  it('reprise `null` pour un rôle autorisé (pas de reprise sur ce dossier) : clé PRÉSENTE à `null`, jamais confondue avec une absence', () => {
    const reponse = versDossierVenteResponse(
      entreeMapperFixture({ role: 'direction', reprise: null }),
    );
    expect('reprise' in reponse).toBe(true);
    expect(reponse.reprise).toBeNull();
  });
});
