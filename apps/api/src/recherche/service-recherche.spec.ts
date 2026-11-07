import { describe, expect, it, vi } from 'vitest';
import type { ParametresRecherche, RoleUtilisateur } from '@dfa/shared';

import type { PrincipalAuthentifie, ServiceContexteRequete } from '../common/contexte';
import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { ServiceRecherche } from './service-recherche';

/**
 * Tests de la matrice rôle x nature pour les TROIS natures ajoutées (`article`, `fournisseur`,
 * `depot_pneu`) — C'EST CE TEST QUI COMPTE (consigne explicite de la tâche) : un rôle sans le
 * droit propre à une nature ne doit JAMAIS recevoir de résultat de cette nature, même si `types`
 * la demande explicitement.
 *
 * Style de mock aligné sur `pneus/service-depot-pneus.spec.ts` (seul patron de mock de
 * `AccesBase`/`TransactionDfa` trouvé dans le dépôt — aucun test préexistant dans `recherche/`).
 * `ServiceContexteRequete` mocké comme dans `common/securite/garde-limitation-recherche.spec.ts`.
 *
 * Chaque test restreint `types` à UNE SEULE nature (`params.types = ['article']`, etc.) : la
 * mécanique interne de `rechercher()` n'appelle alors `tx.execute()` qu'une seule fois (les
 * branches non demandées résolvent en `Promise.resolve([])` sans toucher `tx`), ce qui évite
 * d'avoir à rejouer l'ordre exact des appels `tx.execute()` à travers `Promise.all` (complexité
 * déjà présente pour `chercherVehicules`, qui appelle `tx.execute()` deux fois en interne, non
 * exercée ici — hors périmètre de cette extension, non modifiée par elle).
 */

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

/** Vrai pour la lecture des modules retirés (`select modules_desactives ... from tenant`). */
function estLectureModules(requete: unknown): boolean {
  return JSON.stringify(requete).includes('modules_desactives');
}

function txFactice(
  executes: ReadonlyArray<{ rows: readonly unknown[] }>,
  modulesDesactives: readonly string[] = [],
) {
  const file = [...executes];
  return {
    // La lecture des modules ne consomme pas la file des requêtes de recherche.
    execute: vi.fn((requete: unknown) =>
      Promise.resolve(
        estLectureModules(requete)
          ? { rows: [{ modules_desactives: modulesDesactives }] }
          : (file.shift() ?? { rows: [] }),
      ),
    ),
  } as unknown as TransactionDfa;
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
      travail(tx),
    ),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  } as unknown as AccesBase;
}

function contexteRequeteTest(role: RoleUtilisateur): ServiceContexteRequete {
  const principal: PrincipalAuthentifie = {
    sessionId: 'session-1',
    tenantId: 'tid-1',
    utilisateurId: 'u1',
    role,
    langue: 'fr',
  };
  return {
    exigerPrincipal: vi.fn(() => principal),
  } as unknown as ServiceContexteRequete;
}

function params(surcharges: Partial<ParametresRecherche>): ParametresRecherche {
  return { q: 'test', limite: 20, ...surcharges };
}

// =================================================================================================
// article — portillon pieces.article.lire
// =================================================================================================

describe('ServiceRecherche.rechercher — nature "article" (pieces.article.lire)', () => {
  it('chef_atelier (habilité) reçoit le résultat article', async () => {
    const tx = txFactice([
      {
        rows: [
          {
            id: 'art-1',
            designation: 'Plaquette de frein avant',
            reference_principale: 'REF-123',
            numero_article: 'A-000042',
            statut: 'actif',
            champ: 'designation',
            valeur_matchee: 'Plaquette de frein avant',
            score: 0.9,
          },
        ],
      },
    ]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('chef_atelier'));

    const reponse = await service.rechercher(CTX, params({ types: ['article'] }));

    expect(reponse.resultats).toHaveLength(1);
    expect(reponse.resultats[0]).toMatchObject({
      type: 'article',
      id: 'art-1',
      resume: { designation: 'Plaquette de frein avant', referencePrincipale: 'REF-123' },
    });
  });

  it('admin (RF-115, [] sur pieces.article.lire) ne reçoit JAMAIS de résultat article, même demandé explicitement', async () => {
    // Aucune ligne fournie au mock : si le service appelait quand même tx.execute(), le test
    // échouerait de toute façon faute de résultat exploitable — la garantie testée est que la
    // branche article n'est PAS exécutée du tout pour ce rôle.
    const tx = txFactice([]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('admin'));

    const reponse = await service.rechercher(CTX, params({ types: ['article'] }));

    expect(reponse.resultats).toEqual([]);
    expect(tx.execute).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// fournisseur — portillon pieces.fournisseur.lire
// =================================================================================================

describe('ServiceRecherche.rechercher — nature "fournisseur" (pieces.fournisseur.lire)', () => {
  it('chef_atelier (habilité) reçoit le résultat fournisseur', async () => {
    const tx = txFactice([
      { rows: [{ id: 'four-1', nom: 'Garage Fournitures SA', statut: 'actif', score: 0.85 }] },
    ]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('chef_atelier'));

    const reponse = await service.rechercher(CTX, params({ types: ['fournisseur'] }));

    expect(reponse.resultats).toHaveLength(1);
    expect(reponse.resultats[0]).toMatchObject({
      type: 'fournisseur',
      id: 'four-1',
      correspondance: { champ: 'nom', valeur: 'Garage Fournitures SA' },
      resume: { nom: 'Garage Fournitures SA', statut: 'actif' },
    });
  });

  it('admin (RF-115, [] sur pieces.fournisseur.lire) ne reçoit JAMAIS de résultat fournisseur, même demandé explicitement', async () => {
    const tx = txFactice([]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('admin'));

    const reponse = await service.rechercher(CTX, params({ types: ['fournisseur'] }));

    expect(reponse.resultats).toEqual([]);
    expect(tx.execute).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// depot_pneu — portillon pneus.depot.lire (ouvert à 7 des 8 rôles, poste_atelier exclu)
// =================================================================================================

describe('ServiceRecherche.rechercher — nature "depot_pneu" (pneus.depot.lire)', () => {
  it('direction (habilité) reçoit le résultat depot_pneu', async () => {
    const tx = txFactice([
      {
        rows: [
          {
            id: 'depot-1',
            saison: 'hiver',
            statut: 'en_depot',
            code_case: 'B-12',
            dimension: '205/55 R16',
            marque: 'VW',
            modele: 'Golf',
            version: null,
            plaque_courante: 'VD 123456',
            detenteur_type: 'particulier',
            detenteur_nom: 'Dupont',
            detenteur_prenom: 'Jean',
            detenteur_raison_sociale: null,
            champ: 'plaque',
            valeur_matchee: 'VD 123456',
            score: 0.95,
          },
        ],
      },
    ]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('direction'));

    const reponse = await service.rechercher(CTX, params({ types: ['depot_pneu'] }));

    expect(reponse.resultats).toHaveLength(1);
    expect(reponse.resultats[0]).toMatchObject({
      type: 'depot_pneu',
      id: 'depot-1',
      correspondance: { champ: 'plaque', valeur: 'VD 123456' },
      resume: {
        saison: 'hiver',
        statut: 'en_depot',
        codeCase: 'B-12',
        detenteurNom: 'Jean Dupont',
      },
    });
  });

  it('poste_atelier ([] sur pneus.depot.lire) ne reçoit JAMAIS de résultat depot_pneu, même demandé explicitement', async () => {
    const tx = txFactice([]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('poste_atelier'));

    const reponse = await service.rechercher(CTX, params({ types: ['depot_pneu'] }));

    expect(reponse.resultats).toEqual([]);
    expect(tx.execute).not.toHaveBeenCalled();
  });
});

// =================================================================================================
// Régression — les natures préexistantes restent fonctionnelles après l'extension du
// Promise.all/tableau fusionné (positions 0-3 inchangées, article/fournisseur/depot_pneu ajoutés
// en fin de tableau uniquement).
// =================================================================================================

describe('ServiceRecherche.rechercher — régression sur les natures préexistantes', () => {
  it('client : toujours renvoyé pour un rôle quelconque (aucun portillon supplémentaire)', async () => {
    const tx = txFactice([
      {
        rows: [
          {
            id: 'cli-1',
            type: 'particulier',
            numero: 'C-000001',
            nom: 'Dupont',
            prenom: 'Jean',
            raison_sociale: null,
            telephone: null,
            localite: 'Lausanne',
            champ: 'nom',
            valeur_matchee: 'Jean Dupont',
            score: 0.9,
          },
        ],
      },
    ]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('technicien'));

    const reponse = await service.rechercher(CTX, params({ types: ['client'] }));

    expect(reponse.resultats).toHaveLength(1);
    expect(reponse.resultats[0]).toMatchObject({ type: 'client', id: 'cli-1' });
  });

  it('ordre_reparation : toujours renvoyé pour un rôle quelconque (aucun portillon supplémentaire)', async () => {
    const tx = txFactice([
      {
        rows: [
          {
            id: 'or-1',
            numero: '2026-00042',
            statut: 'en_cours',
            attente_accord: false,
            attente_pieces: false,
            attente_externe: false,
            plaque_figee: 'VD 123456',
            marque: 'VW',
            modele: 'Golf',
            version: null,
            score: 1,
          },
        ],
      },
    ]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('technicien'));

    const reponse = await service.rechercher(CTX, params({ types: ['ordre_reparation'] }));

    expect(reponse.resultats).toHaveLength(1);
    expect(reponse.resultats[0]).toMatchObject({ type: 'ordre_reparation', id: 'or-1' });
  });

  it('document_vente : portillon facturation.document.lire toujours appliqué (technicien l’a, reçoit le résultat)', async () => {
    const tx = txFactice([
      {
        rows: [
          {
            id: 'doc-1',
            numero: '2026-00007',
            type_document: 'facture',
            statut: 'emis',
            client_designation_figee: 'Dupont Jean',
            date_document: '2026-08-01',
            score: 1,
          },
        ],
      },
    ]);
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('technicien'));

    const reponse = await service.rechercher(CTX, params({ types: ['document_vente'] }));

    expect(reponse.resultats).toHaveLength(1);
    expect(reponse.resultats[0]).toMatchObject({ type: 'document_vente', id: 'doc-1' });
  });
});

// =================================================================================================
// Modules désactivés — aucune nature d'un module retiré ne remonte
// =================================================================================================

describe('ServiceRecherche.rechercher — modules désactivés', () => {
  it.each([
    ['article', 'pieces'],
    ['fournisseur', 'pieces'],
    ['depot_pneu', 'pneus'],
    ['ordre_reparation', 'atelier'],
  ] as const)(
    'la nature « %s » ne remonte rien quand le module « %s » est retiré (aucune requête de recherche)',
    async (type, module) => {
      const tx = txFactice([{ rows: [{ id: 'x', score: 1 }] }], [module]);
      const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('chef_atelier'));

      const reponse = await service.rechercher(CTX, params({ types: [type] }));

      expect(reponse.resultats).toEqual([]);
      // Seule la lecture des modules a touché la base.
      expect(tx.execute).toHaveBeenCalledTimes(1);
    },
  );

  it('retirer « atelier » laisse les articles (autre module)', async () => {
    const tx = txFactice(
      [
        {
          rows: [
            {
              id: 'art-1',
              designation: 'Plaquette',
              reference_principale: 'R1',
              numero_article: 'A-1',
              statut: 'actif',
              champ: 'designation',
              valeur_matchee: 'Plaquette',
              score: 0.9,
            },
          ],
        },
      ],
      ['atelier'],
    );
    const service = new ServiceRecherche(accesFactice(tx), contexteRequeteTest('chef_atelier'));

    const reponse = await service.rechercher(CTX, params({ types: ['article'] }));

    expect(reponse.resultats).toHaveLength(1);
  });
});
