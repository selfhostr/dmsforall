import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneConsigneEchangeStandard } from '../db/schema';
import { ServiceConsigne } from './service-consigne';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneConsigne(
  champs: Partial<LigneConsigneEchangeStandard> = {},
): LigneConsigneEchangeStandard {
  return {
    id: 'c1',
    tenantId: 'tid-1',
    ligneOrId: 'lo1',
    ordreReparationId: 'or1',
    articleId: 'art-alternateur',
    siteId: 'site-1',
    statut: 'en_attente_retour_fournisseur',
    montantConsigneTtcCentimes: 16215,
    documentVenteLigneConsigneId: 'ldoc-1',
    mouvementEntreeId: 'mvt-entree-1',
    retourneeFournisseurLe: null,
    mouvementRetourId: null,
    avoirDocumentId: null,
    creeLe: new Date('2026-07-01T08:00:00.000Z'),
    ...champs,
  } as LigneConsigneEchangeStandard;
}

/**
 * `execute` : file FIFO pour le SQL brut (`chargerOu404`/`chargerAvecQuantiteOu404PourVerrou`,
 * l'UPDATE final de `marquerRetourFournisseurTx`). `inserts` : file FIFO pour CHAQUE
 * `tx.insert(table).values(v).returning()`, quelle que soit la table — nécessaire depuis
 * `creerDepuisRealisationTx`, qui insère mouvement PUIS consigne dans cet ordre (même doctrine que
 * `atelier/service-ligne-or.spec.ts::insertPersonnalise`, généralisée ici). `selects` : file FIFO
 * pour `tx.select().from(table).where().limit()`, nécessaire pour `chargerArticleOu404`.
 */
function txFactice(
  config: {
    executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
    inserts?: ReadonlyArray<readonly unknown[]>;
    selects?: ReadonlyArray<readonly unknown[]>;
  } = {},
) {
  const executesFile = [...(config.executes ?? [])];
  const insertsFile = [...(config.inserts ?? [])];
  const selectsFile = [...(config.selects ?? [])];
  const insertValuesArgs: unknown[] = [];
  const tx = {
    execute: vi.fn(() => Promise.resolve(executesFile.shift() ?? { rows: [] })),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        const lignes = insertsFile.shift() ?? [];
        return { returning: () => Promise.resolve(lignes) };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectsFile.shift() ?? []),
        }),
      }),
    }),
  };
  return { tx: tx as unknown as TransactionDfa, insertValuesArgs };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceConsigne.marquerRetourFournisseur — RP-39/RP-40 : le client ramène la vieille pièce', () => {
  it('refuse (409 CONSIGNE_TRANSITION_INTERDITE) une consigne déjà retournée, sans générer de second mouvement', async () => {
    const { tx, insertValuesArgs } = txFactice({
      executes: [
        {
          rows: [
            {
              ...ligneConsigne({ statut: 'retournee_fournisseur' }),
              quantiteLigneOrMillieme: 1000,
            },
          ],
        },
      ],
    });
    const service = new ServiceConsigne(accesFactice(tx));

    await expect(service.marquerRetourFournisseur(CTX, 'c1')).rejects.toMatchObject({
      code: 'CONSIGNE_TRANSITION_INTERDITE',
      status: 409,
    });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('404 RESSOURCE_INTROUVABLE quand la consigne n’existe pas pour ce tenant', async () => {
    const { tx } = txFactice({ executes: [{ rows: [] }] });
    const service = new ServiceConsigne(accesFactice(tx));

    await expect(service.marquerRetourFournisseur(CTX, 'inconnue')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });

  it('en_attente_retour_fournisseur : insère un mouvement retour_consigne de quantité NÉGATIVE (celle de la ligne d’OR d’origine), marque la consigne terminale', async () => {
    const { tx, insertValuesArgs } = txFactice({
      executes: [
        { rows: [{ ...ligneConsigne(), quantiteLigneOrMillieme: 1000 }] }, // FOR UPDATE jointe à ligne_or
        { rows: [] }, // UPDATE consigne
        {
          rows: [
            ligneConsigne({
              statut: 'retournee_fournisseur',
              retourneeFournisseurLe: new Date(),
              mouvementRetourId: 'mvt-retour-1',
            }),
          ],
        }, // reload
      ],
      inserts: [[{ id: 'mvt-retour-1' }]],
    });
    const service = new ServiceConsigne(accesFactice(tx));

    const resultat = await service.marquerRetourFournisseur(CTX, 'c1');

    expect(resultat.statut).toBe('retournee_fournisseur');
    expect(resultat.mouvementRetourId).toBe('mvt-retour-1');
    expect(insertValuesArgs[0]).toMatchObject({
      type: 'retour_consigne',
      quantiteMillieme: -1000,
      articleId: 'art-alternateur',
      siteId: 'site-1',
    });
  });

  it("n'ouvre AUCUNE connexion propre : `acces.enTenant` n'est JAMAIS appelé quand on invoque directement `marquerRetourFournisseurTx` avec un `tx` externe", async () => {
    const { tx } = txFactice({
      executes: [
        { rows: [{ ...ligneConsigne(), quantiteLigneOrMillieme: 1000 }] },
        { rows: [] },
        { rows: [ligneConsigne({ statut: 'retournee_fournisseur' })] },
      ],
      inserts: [[{ id: 'mvt-retour-2' }]],
    });
    const acces = accesFactice(tx);
    const service = new ServiceConsigne(acces);

    await service.marquerRetourFournisseurTx(tx, CTX, 'c1');

    expect(acces.enTenant).not.toHaveBeenCalled();
  });
});

/**
 * RP-38 (§6.4) — dette technique soldée (rapport de livraison étape 3-4) : cette création n'existait
 * QUE recopiée dans `atelier/service-ligne-or.ts` avant cette tâche. Elle vit maintenant à un seul
 * endroit, ici, appelée par `ServiceLigneOr.marquerRealisee` DANS SON `tx` — jamais via un
 * entrypoint HTTP dédié (aucun `POST /consignes`, voir la doc de la méthode).
 */
describe('ServiceConsigne.creerDepuisRealisationTx — RP-38 : consigne posée à la réalisation d’une ligne de dépose', () => {
  const PARAMETRES = {
    ligneOrId: 'lo1',
    ordreReparationId: 'or1',
    articleId: 'art-alternateur',
    siteId: 'site-1',
    quantiteMillieme: 1000,
    auteurId: 'u1',
  };

  it("article NON d'échange standard → rend `null`, AUCUNE écriture (rien à consigner)", async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ estEchangeStandard: false, montantConsigneTtcCentimes: null }]],
    });
    const service = new ServiceConsigne(accesFactice(tx));

    const resultat = await service.creerDepuisRealisationTx(tx, CTX, PARAMETRES);

    expect(resultat).toBeNull();
    expect(insertValuesArgs).toHaveLength(0);
  });

  it("article d'échange standard SANS montant de consigne renseigné → ERREUR_INTERNE défensive (article_consigne_coherente_chk, 0022, ne devrait jamais laisser passer ce cas)", async () => {
    const { tx } = txFactice({
      selects: [[{ estEchangeStandard: true, montantConsigneTtcCentimes: null }]],
    });
    const service = new ServiceConsigne(accesFactice(tx));

    await expect(service.creerDepuisRealisationTx(tx, CTX, PARAMETRES)).rejects.toMatchObject({
      code: 'ERREUR_INTERNE',
    });
  });

  it("article d'échange standard → mouvement retour_consigne POSITIF (entrée du cœur) PUIS consigne_echange_standard, dans cet ordre", async () => {
    const consigneInseree = ligneConsigne({
      articleId: 'art-alternateur',
      montantConsigneTtcCentimes: 12_000,
      mouvementEntreeId: 'mvt-entree-consigne-1',
    });
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ estEchangeStandard: true, montantConsigneTtcCentimes: 12_000 }]],
      inserts: [[{ id: 'mvt-entree-consigne-1' }], [consigneInseree]],
    });
    const service = new ServiceConsigne(accesFactice(tx));

    const resultat = await service.creerDepuisRealisationTx(tx, CTX, PARAMETRES);

    expect(resultat?.montantConsigneTtcCentimes).toBe(12_000);
    expect(resultat?.mouvementEntreeId).toBe('mvt-entree-consigne-1');

    expect(insertValuesArgs).toHaveLength(2);
    expect(insertValuesArgs[0]).toMatchObject({
      articleId: 'art-alternateur',
      type: 'retour_consigne',
      quantiteMillieme: 1000, // positif : entrée du cœur d'échange standard (symétrique de RP-40)
      siteId: 'site-1',
      ligneOrId: 'lo1',
    });
    expect(insertValuesArgs[1]).toMatchObject({
      ligneOrId: 'lo1',
      ordreReparationId: 'or1',
      articleId: 'art-alternateur',
      siteId: 'site-1',
      montantConsigneTtcCentimes: 12_000,
      mouvementEntreeId: 'mvt-entree-consigne-1',
    });
  });

  it("n'ouvre AUCUNE connexion propre : `acces.enTenant` n'est JAMAIS appelé (l'appelant, `ServiceLigneOr`, maîtrise entièrement la transaction)", async () => {
    const { tx } = txFactice({
      selects: [[{ estEchangeStandard: false, montantConsigneTtcCentimes: null }]],
    });
    const acces = accesFactice(tx);
    const service = new ServiceConsigne(acces);

    await service.creerDepuisRealisationTx(tx, CTX, PARAMETRES);

    expect(acces.enTenant).not.toHaveBeenCalled();
  });
});
