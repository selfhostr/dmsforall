import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import { documentVente, ligneDocument, ligneOr, ordreReparation } from '../db/schema';
import type { LigneClient, LigneLigneOr, LigneOrdreReparation } from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import type { Horloge } from '../common/horloge/horloge';

/**
 * Défaut soldé (signalé par l'agent facturation, non corrigeable par lui — hors de son périmètre
 * d'écriture `apps/api/src/facturation/**`) : `ServiceFacturationOr.facturer` insérait
 * `conditionsPaiementFigees: {}` INCONDITIONNELLEMENT, alors que facturer depuis un OR est le
 * chemin le PLUS COURANT dans un garage — sans ce correctif, `date_echeance` (calculée à
 * l'émission depuis `conditions_paiement_figees.delaiPaiementJours`, voir
 * `facturation/documents/echeance.ts`) restait TOUJOURS `null` pour la majorité des factures
 * réelles, quelle que soit la paramétrisation du client. Reprend le correctif de référence déjà
 * commité côté facturation : `chargerConditionsPaiementEnVigueur`
 * (`facturation/documents/references.ts`), MÊME patron que `atelier/references.ts::
 * chargerConditionsEnVigueur` déjà utilisé par `service-snapshot-or.ts` pour figer les conditions
 * d'un OR.
 *
 * Fonctions de requête et transaction MOQUÉES — même doctrine que `service-ligne-or.spec.ts` : ce
 * fichier ne prouve pas une écriture réelle en base (testcontainers, hors périmètre unitaire), il
 * prouve que `facturer()` transmet EXACTEMENT ce que `chargerConditionsPaiementEnVigueur` a rendu
 * (délai paramétré, ou `{}` si le client n'a aucune condition en vigueur) à l'INSERT de
 * `document_vente`, pour le DESTINATAIRE réel du groupe (pas toujours `or.clientId, RF-92`).
 */
vi.mock('./or-requetes', () => ({
  chargerOrPourEcriture: vi.fn(),
  listerLignesOrPourEcriture: vi.fn(),
}));
vi.mock('./references', () => ({
  chargerClientLigne: vi.fn(),
  nomAfficheClient: vi.fn(() => 'Jean Dupont'),
}));
vi.mock('../facturation/documents/references', () => ({
  chargerAdresseFacturationStructuree: vi.fn(async () => ({})),
  chargerConditionsPaiementEnVigueur: vi.fn(),
}));

import type { EntreeFacturationOrdreReparation } from '@dfa/shared';
import {
  ligneAppartientAuGroupe,
  ServiceFacturationOr,
  typeLigneDocumentDepuisOr,
} from './service-facturation-or';
import * as orRequetes from './or-requetes';
import * as references from './references';
import * as facturationReferences from '../facturation/documents/references';

function ligne(surcharge: Partial<LigneLigneOr>): LigneLigneOr {
  return {
    id: 'l',
    tenantId: 't',
    ordreReparationId: 'or',
    numeroOrdre: 1,
    type: 'piece',
    origine: 'commandee',
    statut: 'realisee',
    payeur: 'client',
    payeurClientId: null,
    blocage: 'aucun',
    designation: 'x',
    referenceTexte: null,
    articleId: null,
    quantiteMillieme: 1000,
    tempsBaremeCentiemes: null,
    tempsBaremeConstructeurCentiemes: null,
    tauxHoraireCentimes: null,
    prixUnitaireCentimes: 10000,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    montantHtCentimes: 10000,
    montantTvaCentimes: 810,
    montantTtcCentimes: 10810,
    technicienId: null,
    codeOperation: null,
    codeDefaut: null,
    numeroSinistre: null,
    numeroAccord: null,
    urgence: null,
    securite: false,
    fourniParClient: false,
    aRestituer: false,
    restituee: false,
    motifAnnulation: null,
    factureId: null,
    creeLe: new Date(),
    modifieLe: new Date(),
    ...surcharge,
  } as LigneLigneOr;
}

describe('ligneAppartientAuGroupe (RF-81, MD-62, RF-92)', () => {
  it("une ligne payeur='client' appartient au groupe {payeur:'client'}", () => {
    expect(ligneAppartientAuGroupe(ligne({ payeur: 'client' }), { payeur: 'client' })).toBe(true);
  });

  it("RF-92 : une ligne payeur='garage' rejoint AUSSI le groupe {payeur:'client'} — jamais un groupe séparé", () => {
    expect(ligneAppartientAuGroupe(ligne({ payeur: 'garage' }), { payeur: 'client' })).toBe(true);
  });

  it("une ligne payeur='assurance' n'appartient PAS au groupe {payeur:'client'}", () => {
    expect(
      ligneAppartientAuGroupe(ligne({ payeur: 'assurance', payeurClientId: 'zurich' }), {
        payeur: 'client',
      }),
    ).toBe(false);
  });

  it("MD-62 : deux lignes payeur='assurance' avec des payeurClientId DIFFÉRENTS n'appartiennent PAS au même groupe — c'est le bug historique que RF-81 doit éviter", () => {
    const ligneZurich = ligne({ payeur: 'assurance', payeurClientId: 'zurich' });
    const ligneAxa = ligne({ payeur: 'assurance', payeurClientId: 'axa' });
    const groupeZurich = { payeur: 'assurance', payeurClientId: 'zurich' } as const;

    expect(ligneAppartientAuGroupe(ligneZurich, groupeZurich)).toBe(true);
    expect(ligneAppartientAuGroupe(ligneAxa, groupeZurich)).toBe(false);
  });

  it("une ligne payeur='tiers' avec payeurClientId=X appartient au groupe {payeur:'tiers', payeurClientId:X} exact", () => {
    const l = ligne({ payeur: 'tiers', payeurClientId: 'garagiste-partenaire' });
    expect(
      ligneAppartientAuGroupe(l, { payeur: 'tiers', payeurClientId: 'garagiste-partenaire' }),
    ).toBe(true);
    expect(ligneAppartientAuGroupe(l, { payeur: 'tiers', payeurClientId: 'autre-tiers' })).toBe(
      false,
    );
  });

  it("une ligne payeur='garage' n'appartient à AUCUN groupe tiers (assurance/constructeur/tiers) — repli 'client' uniquement", () => {
    const l = ligne({ payeur: 'garage' });
    expect(ligneAppartientAuGroupe(l, { payeur: 'assurance', payeurClientId: 'zurich' })).toBe(
      false,
    );
  });
});

describe('typeLigneDocumentDepuisOr', () => {
  it('reprend à l’identique les neuf types partagés entre ligne_or et ligne_document', () => {
    const partages: ReadonlyArray<LigneLigneOr['type']> = [
      'main_oeuvre_bareme',
      'main_oeuvre_temps_reel',
      'forfait',
      'piece',
      'fourniture',
      'sous_traitance',
      'produit_atelier',
      'taxe',
      'texte',
    ];
    for (const type of partages) {
      expect(typeLigneDocumentDepuisOr(type)).toBe(type);
    }
  });

  it("'remise' (sans équivalent facturation, RF-45) replie sur 'repartition' — interprétation signalée", () => {
    expect(typeLigneDocumentDepuisOr('remise')).toBe('repartition');
  });
});

/* ------------------------------------------------------------------------------------------- */
/* RM-07/RF-04/PF-04 : conditions de paiement figées à l'insertion du document_vente             */
/* ------------------------------------------------------------------------------------------- */

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';
const CLIENT_ID = 'client-1';
const MAINTENANT = new Date('2026-08-01T09:00:00.000Z');

function principal(role: PrincipalAuthentifie['role']): PrincipalAuthentifie {
  return {
    sessionId: 'session-1',
    tenantId: 'tenant-a',
    utilisateurId: 'user-1',
    role,
    langue: 'fr',
  };
}

function orFixture(): LigneOrdreReparation {
  return {
    id: OR_ID,
    tenantId: 'tenant-a',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'termine',
    clientId: CLIENT_ID,
    vehiculeId: 'vehicule-1',
    clientDesignationFigee: 'Jean Dupont',
    adresseFacturationFigee: {},
    conditionsFigees: {},
    plaqueFigee: 'VD 123456',
    detenteurFigeClientId: null,
    conducteurPresentNom: null,
    kmEntree: 85_000,
    kmSortie: 85_120,
    plafondCentimes: null,
    plafondAutorisePar: null,
    restitutionPromiseLe: null,
    restitutionInitialeLe: null,
    localisation: 'atelier',
    sousTraitantNom: null,
    ordreReparationParentId: null,
    motifLien: null,
    rendezVousId: null,
    numeroCommandeInterne: null,
    receptionnaireId: 'user-1',
    retentionInvoqueeLe: null,
    litigeOuvertLe: null,
    ouvertLe: new Date('2026-07-28T07:00:00.000Z'),
    termineLe: new Date('2026-07-31T16:00:00.000Z'),
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    attenteAccord: false,
    attentePieces: false,
    attenteExterne: false,
    totalValideCentimes: 10_810,
    version: 1,
    creeLe: new Date('2026-07-28T07:00:00.000Z'),
    modifieLe: new Date('2026-07-31T16:00:00.000Z'),
  } as LigneOrdreReparation;
}

function clientFixture(overrides: Partial<LigneClient> = {}): LigneClient {
  return {
    id: CLIENT_ID,
    tenantId: 'tenant-a',
    type: 'particulier',
    nom: 'Dupont',
    prenom: 'Jean',
    raisonSociale: null,
    ide: null,
    langue: 'fr',
    statut: 'actif',
    ...overrides,
  } as LigneClient;
}

/** `insert`/`update` génériques, indexés par référence de TABLE Drizzle — même doctrine que
 *  `service-ligne-or.spec.ts::construireInsert/construireUpdate`, mais réunis ici (un seul scénario
 *  à la fois dans ce fichier, pas besoin de builders réutilisables séparés). */
function txFactice() {
  const insertsDocumentVente: Record<string, unknown>[] = [];
  const insertsLigneDocument: Record<string, unknown>[] = [];
  const updatesLigneOr: Record<string, unknown>[] = [];
  const updatesOrdreReparation: Record<string, unknown>[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        if (table === documentVente) {
          insertsDocumentVente.push(vals);
          return { returning: () => Promise.resolve([{ id: 'doc-1', ...vals }]) };
        }
        if (table === ligneDocument) {
          insertsLigneDocument.push(vals);
        }
        return Promise.resolve(undefined);
      },
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => {
          if (table === ligneOr) updatesLigneOr.push(vals);
          if (table === ordreReparation) updatesOrdreReparation.push(vals);
          return Promise.resolve(undefined);
        },
      }),
    }),
  };
  return {
    tx: tx as unknown as TransactionDfa,
    insertsDocumentVente,
    insertsLigneDocument,
    updatesLigneOr,
    updatesOrdreReparation,
  };
}

function serviceFactice(tx: TransactionDfa): ServiceFacturationOr {
  const idempotence = {
    executer: vi.fn(
      async (
        _ctx: ContexteTenant,
        _requete: unknown,
        travail: (tx: TransactionDfa) => Promise<{ statutHttp: number; corps: unknown }>,
      ) => ({ reponse: await travail(tx), rejoue: false }),
    ),
  };
  const horloge = { maintenant: () => MAINTENANT } as unknown as Horloge;
  const serviceOr = { assemblerDocument: vi.fn(async () => ({})) };
  const documents = { assemblerDocument: vi.fn(async () => ({})) };
  return new ServiceFacturationOr(
    {} as never,
    idempotence as never,
    horloge,
    serviceOr as never,
    documents as never,
  );
}

function entreeFacturationFixture(): EntreeFacturationOrdreReparation {
  return { groupes: [{ payeur: 'client' }] } as EntreeFacturationOrdreReparation;
}

describe('ServiceFacturationOr.facturer — RM-07/RF-04/PF-04 : conditions de paiement figées (défaut soldé)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('client AVEC un délai de paiement paramétré → conditions_paiement_figees porte EXACTEMENT ce que chargerConditionsPaiementEnVigueur a rendu, pour le BON destinataire et la BONNE date', async () => {
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(orFixture());
    vi.mocked(orRequetes.listerLignesOrPourEcriture).mockResolvedValue([
      ligne({ id: 'ligne-1', ordreReparationId: OR_ID, statut: 'realisee' }),
    ]);
    vi.mocked(references.chargerClientLigne).mockResolvedValue(clientFixture());
    const conditionsEnVigueur = {
      delaiPaiementJours: 30,
      modePaiement: 'facture',
      rabaisMoPourmille: 0,
      rabaisPiecesPourmille: 0,
      rabaisPneusPourmille: 0,
      tauxHoraireCode: null,
      plafondCentimes: null,
    };
    vi.mocked(facturationReferences.chargerConditionsPaiementEnVigueur).mockResolvedValue(
      conditionsEnVigueur,
    );

    const { tx, insertsDocumentVente } = txFactice();
    const service = serviceFactice(tx);

    await service.facturer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreeFacturationFixture(),
      'idem-1',
    );

    expect(insertsDocumentVente).toHaveLength(1);
    expect(insertsDocumentVente[0]?.conditionsPaiementFigees).toEqual(conditionsEnVigueur);

    expect(facturationReferences.chargerConditionsPaiementEnVigueur).toHaveBeenCalledWith(
      tx,
      CTX,
      CLIENT_ID, // destinataire du groupe {payeur:'client'} = or.clientId
      new Date('2026-08-01T00:00:00.000Z'), // dateDocument dérivée de `maintenant`, à minuit UTC
    );
  });

  it("client SANS condition de paiement en vigueur → conditions_paiement_figees = {} (échéance restera nulle), AUCUNE erreur, le document brouillon est quand même créé (non-régression du parcours de facturation d'OR)", async () => {
    vi.mocked(orRequetes.chargerOrPourEcriture).mockResolvedValue(orFixture());
    vi.mocked(orRequetes.listerLignesOrPourEcriture).mockResolvedValue([
      ligne({ id: 'ligne-1', ordreReparationId: OR_ID, statut: 'realisee' }),
    ]);
    vi.mocked(references.chargerClientLigne).mockResolvedValue(clientFixture());
    vi.mocked(facturationReferences.chargerConditionsPaiementEnVigueur).mockResolvedValue({});

    const { tx, insertsDocumentVente, updatesLigneOr, updatesOrdreReparation } = txFactice();
    const service = serviceFactice(tx);

    const resultat = await service.facturer(
      CTX,
      principal('receptionnaire'),
      OR_ID,
      entreeFacturationFixture(),
      'idem-2',
    );

    expect(insertsDocumentVente).toHaveLength(1);
    expect(insertsDocumentVente[0]?.conditionsPaiementFigees).toEqual({});
    // Non-régression : le reste du parcours (ligne d'OR facturée, OR transitionné) tourne toujours.
    expect(updatesLigneOr).toHaveLength(1);
    expect(updatesLigneOr[0]).toMatchObject({ statut: 'facturee' });
    expect(updatesOrdreReparation).toHaveLength(1);
    expect(updatesOrdreReparation[0]).toMatchObject({ statut: 'facture' });
    expect(resultat.reponse.statutHttp).toBe(201);
  });
});
