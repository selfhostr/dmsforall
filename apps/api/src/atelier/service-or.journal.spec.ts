import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FiltresJournal } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../db';
import type { EntreeAudit, ServiceAudit } from '../common/audit';
import type { LigneLigneOr, LigneDevisComplementaire, LigneOrdreReparation } from '../db/schema';

/**
 * Correctif N+1 / non-atomicité de `ServiceOr.journal()` (audit + commentaire du code lui-même,
 * `service-or.ts` avant correction : « SÉRIALISÉ délibérément… chaque appel à `pourEntite` ouvre
 * SA PROPRE transaction »). `journal()` bouclait sur `ServiceAudit.pourEntite` — jusqu'à ~19
 * appels (1 OR + N lignes + M devis), chacun ouvrant sa PROPRE transaction/connexion sur le pool
 * partagé, ALORS que `journal()` tourne déjà dans une transaction (`this.acces.enTenant`). Ce
 * fichier prouve que la version corrigée :
 *   1. Charge l'audit de TOUTES les entités en UN SEUL appel (`ServiceAudit.pourEntitesTx`) —
 *      pas une boucle, quel que soit le nombre de lignes/devis.
 *   2. Passe le `tx` de la transaction APPELANTE à cet appel (même référence d'objet) — donc
 *      aucune transaction imbriquée, lecture atomique avec le reste de `journal()`.
 *   3. N'appelle JAMAIS `ServiceAudit.pourEntite`/`pourEntiteTx` (les variantes par entité) —
 *      un test qui ne vérifierait que le CONTENU du résultat resterait vert si la boucle était
 *      réintroduite avec la nouvelle API (`pourEntitesTx` appelé N fois avec une seule entité à
 *      chaque fois) ; `toHaveBeenCalledTimes(1)` sur `pourEntitesTx` rougit dans ce cas précis.
 *
 * Fonctions de requête et transaction MOQUÉES (pas de base réelle) — même doctrine que
 * `service-or.spec.ts` (mock partiel de `./or-requetes`).
 */
vi.mock('./or-requetes', () => ({
  chargerOr: vi.fn(),
  listerLignesOr: vi.fn(),
  listerDevisOr: vi.fn(),
}));
vi.mock('./references', () => ({
  chargerResumesUtilisateurs: vi.fn().mockResolvedValue(new Map()),
}));

import { ServiceOr } from './service-or';
import * as orRequetes from './or-requetes';
import * as references from './references';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const OR_ID = 'or-1';

/** Marqueur opaque — jamais interrogé directement (toutes les requêtes réelles sont moquées) : ne
 *  sert qu'à prouver, par identité de référence, que le MÊME `tx` traverse toute la méthode. */
const TX_MARQUEUR = { marqueur: 'tx-appelant' } as unknown as TransactionDfa;

function accesBaseFactice() {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(TX_MARQUEUR),
    ),
  };
}

function auditFactice(entrees: readonly EntreeAudit[] = []): ServiceAudit & {
  pourEntite: ReturnType<typeof vi.fn>;
  pourEntiteTx: ReturnType<typeof vi.fn>;
  pourEntitesTx: ReturnType<typeof vi.fn>;
} {
  return {
    pourEntite: vi.fn(),
    pourEntiteTx: vi.fn(),
    pourEntitesTx: vi.fn().mockResolvedValue(entrees),
  };
}

function serviceFactice(acces: ReturnType<typeof accesBaseFactice>, audit: ServiceAudit) {
  return new ServiceOr(
    acces as never,
    {} as never,
    {} as never,
    audit,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

const FILTRES_VIDES: FiltresJournal = { tri: 'survenuLe:desc' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceOr.journal — plus de boucle N+1 sur ServiceAudit (correctif)', () => {
  it("charge l'audit de l'OR + 2 lignes + 1 devis en UN SEUL appel à pourEntitesTx — jamais N appels", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([
      { id: 'ligne-1' } as unknown as LigneLigneOr,
      { id: 'ligne-2' } as unknown as LigneLigneOr,
    ]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([
      { id: 'devis-1' } as unknown as LigneDevisComplementaire,
    ]);
    const acces = accesBaseFactice();
    const audit = auditFactice();
    const service = serviceFactice(acces, audit);

    await service.journal(CTX, OR_ID, FILTRES_VIDES, 25, undefined);

    // Le cœur du correctif : UN SEUL appel, quel que soit le nombre d'entités (ici 4 : l'en-tête
    // + 2 lignes + 1 devis). Un test qui vérifierait seulement le résultat final resterait vert
    // même si `journal()` rappelait `pourEntitesTx` une fois par entité — celui-ci rougirait.
    expect(audit.pourEntitesTx).toHaveBeenCalledTimes(1);

    // Jamais la variante par entité (l'ancienne boucle, ou une régression qui la réintroduirait
    // sous un autre nom) : la garde n+1 porte aussi sur CE qui n'est PAS appelé.
    expect(audit.pourEntite).not.toHaveBeenCalled();
    expect(audit.pourEntiteTx).not.toHaveBeenCalled();

    const [txRecu, ctxRecu, entitesRecues] = audit.pourEntitesTx.mock.calls[0] as [
      TransactionDfa,
      ContexteTenant,
      readonly { entite: string; entiteId: string }[],
    ];

    // Atomicité : le MÊME tx que celui ouvert par `this.acces.enTenant` en tête de `journal()`,
    // jamais une transaction reconstruite/imbriquée pour l'audit.
    expect(txRecu).toBe(TX_MARQUEUR);
    expect(ctxRecu).toBe(CTX);

    expect(entitesRecues).toHaveLength(4);
    expect(entitesRecues).toEqual(
      expect.arrayContaining([
        { entite: 'ordre_reparation', entiteId: OR_ID },
        { entite: 'ligne_or', entiteId: 'ligne-1' },
        { entite: 'ligne_or', entiteId: 'ligne-2' },
        { entite: 'devis_complementaire', entiteId: 'devis-1' },
      ]),
    );
  });

  it("un OR sans ligne ni devis n'appelle pourEntitesTx qu'avec l'en-tête seul — toujours un appel unique", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([]);
    const acces = accesBaseFactice();
    const audit = auditFactice();
    const service = serviceFactice(acces, audit);

    await service.journal(CTX, OR_ID, FILTRES_VIDES, 25, undefined);

    expect(audit.pourEntitesTx).toHaveBeenCalledTimes(1);
    const [, , entitesRecues] = audit.pourEntitesTx.mock.calls[0] as [
      unknown,
      unknown,
      readonly { entite: string; entiteId: string }[],
    ];
    expect(entitesRecues).toEqual([{ entite: 'ordre_reparation', entiteId: OR_ID }]);
  });
});

/** Fabrique une entrée d'audit minimale — seuls `id` et `utilisateurId` varient dans ces tests. */
function entreeAudit(id: string, utilisateurId: string | null): EntreeAudit {
  return {
    id,
    entite: 'ordre_reparation',
    entiteId: OR_ID,
    action: 'creation',
    champ: null,
    valeurAvant: null,
    valeurApres: null,
    utilisateurId,
    requeteId: null,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
  };
}

/**
 * Correctif N+1 sur les RÉSUMÉS UTILISATEUR de `journal()` — distinct du correctif `pourEntitesTx`
 * ci-dessus (celui-ci portait sur `ServiceAudit`, pas sur `chargerResumeUtilisateur`). Avant
 * correction, `journal()` appelait `chargerResumeUtilisateur(tx, ctx, entree.utilisateurId)` une
 * fois PAR ENTRÉE de la page retournée (jusqu'à `limite`, 25 par défaut) — un journal de 10
 * entrées ouvrait 10 requêtes sur `utilisateur`, même quand plusieurs entrées partagent le même
 * auteur. La preuve du test `service-or.journal.spec.ts` existant (ci-dessus, sur
 * `pourEntitesTx`) ne couvrait pas ce défaut : elle ne mesure que les appels à `ServiceAudit`, pas
 * ceux à `./references`.
 */
describe('ServiceOr.journal — résumés utilisateur par lot (correctif N+1)', () => {
  it("une page de 5 entrées d'audit (3 auteurs distincts, doublons compris) ne déclenche qu'UN SEUL appel à chargerResumesUtilisateurs — jamais un par entrée", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([]);
    const acces = accesBaseFactice();
    const audit = auditFactice([
      entreeAudit('audit-1', 'user-a'),
      entreeAudit('audit-2', 'user-a'), // même auteur qu'audit-1 : doit être dédoublonné en base
      entreeAudit('audit-3', 'user-b'),
      entreeAudit('audit-4', null), // pas d'auteur (ex. action système) : jamais résolu en base
      entreeAudit('audit-5', 'user-c'),
    ]);
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(
      new Map([
        ['user-a', { utilisateurId: 'user-a', nomAffiche: 'Alice Un' }],
        ['user-b', { utilisateurId: 'user-b', nomAffiche: 'Bruno Deux' }],
        ['user-c', { utilisateurId: 'user-c', nomAffiche: 'Chloé Trois' }],
      ]),
    );
    const service = serviceFactice(acces, audit);

    const resultat = await service.journal(CTX, OR_ID, FILTRES_VIDES, 25, undefined);

    // Le cœur du correctif : UN SEUL appel, quel que soit le nombre d'entrées (5 ici) — un test
    // qui rétablirait la boucle (un appel par entrée, ou même un appel par auteur distinct)
    // rougirait sur cette seule assertion, avant même de regarder le contenu du résultat.
    expect(references.chargerResumesUtilisateurs).toHaveBeenCalledTimes(1);

    // Appariement correct malgré les doublons : audit-1 ET audit-2 portent bien le nom d'Alice,
    // chacun individuellement — le lot ne doit ni les fusionner ni perdre l'un des deux.
    expect(resultat.donnees.find((d) => d.id === 'audit-1')?.auteur).toEqual({
      utilisateurId: 'user-a',
      nomAffiche: 'Alice Un',
    });
    expect(resultat.donnees.find((d) => d.id === 'audit-2')?.auteur).toEqual({
      utilisateurId: 'user-a',
      nomAffiche: 'Alice Un',
    });
    expect(resultat.donnees.find((d) => d.id === 'audit-3')?.auteur).toEqual({
      utilisateurId: 'user-b',
      nomAffiche: 'Bruno Deux',
    });
    expect(resultat.donnees.find((d) => d.id === 'audit-5')?.auteur).toEqual({
      utilisateurId: 'user-c',
      nomAffiche: 'Chloé Trois',
    });
  });

  it("un utilisateurId sans auteur (null) ne déclenche aucune tentative de résolution : auteur reste null, la ligne n'est pas écartée", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([]);
    const acces = accesBaseFactice();
    const audit = auditFactice([entreeAudit('audit-1', null)]);
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(new Map());
    const service = serviceFactice(acces, audit);

    const resultat = await service.journal(CTX, OR_ID, FILTRES_VIDES, 25, undefined);

    expect(resultat.donnees).toHaveLength(1);
    expect(resultat.donnees[0]?.auteur).toBeNull();
  });

  it("un utilisateurId renseigné mais ABSENT du lot rendu (utilisateur supprimé, ou d'un autre tenant) retombe sur auteur: null — jamais un nom vide, jamais la ligne supprimée (« une absence n'est pas une valeur »)", async () => {
    vi.mocked(orRequetes.chargerOr).mockResolvedValue({} as LigneOrdreReparation);
    vi.mocked(orRequetes.listerLignesOr).mockResolvedValue([]);
    vi.mocked(orRequetes.listerDevisOr).mockResolvedValue([]);
    const acces = accesBaseFactice();
    const audit = auditFactice([entreeAudit('audit-1', 'user-introuvable')]);
    // Le lot ne contient PAS 'user-introuvable' — comportement identique à l'ancien
    // `chargerResumeUtilisateur` quand la ligne SELECT ne rend rien (utilisateur supprimé).
    vi.mocked(references.chargerResumesUtilisateurs).mockResolvedValue(new Map());
    const service = serviceFactice(acces, audit);

    const resultat = await service.journal(CTX, OR_ID, FILTRES_VIDES, 25, undefined);

    expect(resultat.donnees).toHaveLength(1);
    expect(resultat.donnees[0]?.id).toBe('audit-1');
    expect(resultat.donnees[0]?.auteur).toBeNull();
  });
});
