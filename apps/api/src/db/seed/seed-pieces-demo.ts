/**
 * Catalogue d'articles et stock de démonstration (étape 3, pièces) — complète `seed-dev.ts` avec
 * un petit catalogue réaliste, du stock sur les DEUX sites, et un article volontairement SOUS son
 * seuil d'alerte pour que le réapprovisionnement (RP-12) ait quelque chose à montrer.
 *
 * Constat qui motive ce fichier (issue #20, enrichie par un second passage de simulation) :
 * `select count(*) from public.article` rendait 0 après `pnpm db:seed` — le module Pièces, livré
 * en dernier, était entièrement inexplorable : impossible de poser une ligne d'OR reliée à un
 * article, donc impossible d'exercer réservations, sorties de stock ou réappro sans saisir
 * d'abord un catalogue à la main.
 *
 * Même doctrine que `seed-atelier-demo.ts`/`seed-facturation-demo.ts` (voir leurs têtes de
 * fichier, non répétées ici) : jamais `NestFactory`, les VRAIS services de `pieces/`
 * (`ServiceArticle`, `ServiceStock`, `ServiceMouvement`) sont câblés À LA MAIN avec leurs
 * dépendances réelles — le stock physique n'est donc JAMAIS écrit en base directement, il naît
 * d'un vrai mouvement d'ajustement d'inventaire (RP-29 : `article.prixAchatCentimes`/le stock
 * physique ne se posent que par un mouvement, jamais par une saisie manuelle), exactement comme
 * un magasinier compterait son stock d'ouverture.
 *
 * Exécuté AVANT `seed-atelier-demo.ts` dans `seed-dev.ts::principal()` : la ligne « appoint
 * d'huile » ajoutée sur l'OR Octavia (RP-19/RP-20 : une ligne `piece` avec `articleId` réserve la
 * pièce dans la même transaction que sa création) a besoin d'un article ET d'un stock disponible
 * déjà en place pour réserver avec succès plutôt que de retomber sur `blocage: 'pieces'` (RP-24).
 */
import 'reflect-metadata';

import { and, eq } from 'drizzle-orm';
import type {
  EntreeCreationArticle,
  EntreeCreationMouvementSortieComptoir,
  EntreeModificationStockSite,
  RoleUtilisateur,
} from '@dfa/shared';

import { article as articleTable } from '../schema';
import { Horloge } from '../../common/horloge/horloge';
import { ServiceIdempotenceImpl } from '../../common/idempotence';
import { ServiceArticle } from '../../pieces/service-article';
import { ServiceMouvement } from '../../pieces/service-mouvement';
import { ServiceStock } from '../../pieces/service-stock';
import { ServiceAccesBase } from '../acces-base.service';
import type { ConfigBase, ContexteTenant } from '../index';

export interface OptionsSeedPieces {
  readonly config: ConfigBase;
  readonly tenantId: string;
  readonly idsSitesParCode: ReadonlyMap<string, string>;
  readonly idsUtilisateursParRole: ReadonlyMap<string, string>;
  readonly journaliser?: (message: string) => void;
}

export interface ResultatSeedPieces {
  /** Clé = `referencePrincipale` de l'article — reprise par `seed-atelier-demo.ts` pour poser une
   *  ligne d'OR référençant un VRAI article et exercer la réservation (RP-19/RP-20). */
  readonly idsArticlesParReference: ReadonlyMap<string, string>;
}

/** Clés d'idempotence FIXES (uuid v4 littéraux) — même doctrine que `seed-atelier-demo.ts` :
 *  rejouer ce script avec les mêmes clés ET les mêmes corps ne crée jamais de doublon. */
const CLE_ARTICLE_PLAQUETTES = '27d8505a-dbeb-4700-8439-0af3068043f1';
const CLE_ARTICLE_FILTRE_HUILE = '1c63fb08-460e-4253-a455-f13857ff0e25';
const CLE_ARTICLE_HUILE_5W30 = 'c00d1e08-7bbd-4e7c-900e-5c3624d56011';
const CLE_ARTICLE_BALAIS_ESSUIE = '48a20515-88d7-4ba4-a906-33dd397c7973';

const CLE_AJUST_PLAQUETTES_SION = 'ad52f408-9e41-41c0-8c16-643c0e19bc56';
const CLE_AJUST_PLAQUETTES_MARTIGNY = '03096f03-88a2-4e12-9faa-3ba7b91cebf9';
const CLE_AJUST_FILTRE_SION = 'cbe7c62b-3b66-4650-903a-63c444f95432';
const CLE_AJUST_FILTRE_MARTIGNY = '1c4e37bc-491e-4c7b-9f53-f330a776b46f';
const CLE_AJUST_HUILE_SION = '5db13d9a-ddef-4c8e-9a01-3fa1955f7e8e';
const CLE_AJUST_HUILE_MARTIGNY = '4ebc8b94-bf52-4bb2-a6e9-a67a3afe55fc';
const CLE_AJUST_BALAIS_SION = '1fe6ad5a-e56e-4bc8-a45e-457aaa8dac7c';
const CLE_AJUST_BALAIS_MARTIGNY = 'd008c111-da13-482a-be5c-bdee94e44728';

const CLE_SORTIE_COMPTOIR_FILTRE = '24d2554c-73fd-4cef-9fd8-c6abd0ff573b';

/**
 * Catalogue (RP-01 → RP-08) : quatre références courantes de comptoir, en vocabulaire garagiste
 * suisse. `montantConsigneTtcCentimes` reste `null` partout (`estEchangeStandard: false`,
 * RP-37) — aucune de ces quatre références n'est un échange standard.
 */
const ARTICLES_DEMO = [
  {
    reference: 'GDB1330DTE',
    designation: 'Jeu de plaquettes de frein avant',
    marque: 'Textar',
    categorie: 'piece_mecanique' as const,
    prixVenteTtcCentimes: 8_900,
    tauxTvaPourmille: 81,
    stocks: {
      // SION : stock confortable — c'est CET article qu'`seed-atelier-demo.ts` réserve sur l'OR
      // Octavia (voir sa note de tête) ; le laisser largement au-dessus du seuil garantit une
      // réservation qui réussit plutôt qu'un `blocage: 'pieces'` (RP-24).
      SION: {
        stockMinimumMillieme: 2_000,
        quantiteCommandeStandardMillieme: 4_000,
        compteMillieme: 6_000,
        emplacement: 'A-12',
      },
      // MARTIGNY : volontairement SOUS le seuil — le cas d'usage RP-12 (réapprovisionnement).
      MARTIGNY: {
        stockMinimumMillieme: 4_000,
        quantiteCommandeStandardMillieme: 4_000,
        compteMillieme: 1_000,
        emplacement: 'B-03',
      },
    },
  },
  {
    reference: 'OC90',
    designation: 'Filtre à huile',
    marque: 'Mann-Filter',
    categorie: 'piece_mecanique' as const,
    prixVenteTtcCentimes: 1_800,
    tauxTvaPourmille: 81,
    stocks: {
      SION: {
        stockMinimumMillieme: 3_000,
        quantiteCommandeStandardMillieme: 6_000,
        compteMillieme: 8_000,
        emplacement: 'A-04',
      },
      MARTIGNY: {
        stockMinimumMillieme: 3_000,
        quantiteCommandeStandardMillieme: 6_000,
        compteMillieme: 4_000,
        emplacement: 'B-04',
      },
    },
  },
  {
    reference: 'CASTROL-EDGE-5W30-5L',
    designation: "Bidon d'huile moteur 5W30 (5 litres)",
    marque: 'Castrol',
    categorie: 'lubrifiant' as const,
    prixVenteTtcCentimes: 5_900,
    tauxTvaPourmille: 81,
    stocks: {
      SION: {
        stockMinimumMillieme: 5_000,
        quantiteCommandeStandardMillieme: 10_000,
        compteMillieme: 10_000,
        emplacement: 'C-01',
      },
      MARTIGNY: {
        stockMinimumMillieme: 4_000,
        quantiteCommandeStandardMillieme: 8_000,
        compteMillieme: 6_000,
        emplacement: 'C-01',
      },
    },
  },
  {
    reference: 'BOSCH-AEROTWIN-A863S',
    designation: "Jeu de balais d'essuie-glace avant",
    marque: 'Bosch',
    categorie: 'fourniture' as const,
    prixVenteTtcCentimes: 3_600,
    tauxTvaPourmille: 81,
    stocks: {
      SION: {
        stockMinimumMillieme: 3_000,
        quantiteCommandeStandardMillieme: 6_000,
        compteMillieme: 8_000,
        emplacement: 'D-02',
      },
      MARTIGNY: {
        stockMinimumMillieme: 3_000,
        quantiteCommandeStandardMillieme: 6_000,
        compteMillieme: 5_000,
        emplacement: 'D-02',
      },
    },
  },
] as const;

export async function semerPiecesDemo(options: OptionsSeedPieces): Promise<ResultatSeedPieces> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  if (options.config.NODE_ENV === 'production') {
    throw new Error(
      `Le seed de démonstration pièces est interdit en production : il crée un catalogue et des mouvements de stock factices.`,
    );
  }

  const idSion = options.idsSitesParCode.get('SION');
  const idMartigny = options.idsSitesParCode.get('MARTIGNY');
  const idMagasinier = options.idsUtilisateursParRole.get('magasinier');
  if (!idSion || !idMartigny || !idMagasinier) {
    throw new Error(
      `seed-pieces-demo : site SION/MARTIGNY ou compte magasinier introuvable — vérifier que seed-dev.ts a bien été exécuté avant ce script.`,
    );
  }

  const acces = new ServiceAccesBase({
    NODE_ENV: options.config.NODE_ENV,
    DATABASE_URL: options.config.DATABASE_URL,
    DATABASE_POOL_MAX: options.config.DATABASE_POOL_MAX,
    DATABASE_POOL_MIN: options.config.DATABASE_POOL_MIN,
    DATABASE_TIMEOUT_REQUETE_MS: options.config.DATABASE_TIMEOUT_REQUETE_MS,
    DATABASE_TIMEOUT_CONNEXION_MS: options.config.DATABASE_TIMEOUT_CONNEXION_MS,
    DATABASE_TIMEOUT_IDLE_MS: options.config.DATABASE_TIMEOUT_IDLE_MS,
  });

  try {
    const horloge = new Horloge();
    const idempotence = new ServiceIdempotenceImpl(acces, horloge);
    const serviceArticle = new ServiceArticle(acces, idempotence);
    const serviceStock = new ServiceStock(acces);
    const serviceMouvement = new ServiceMouvement(acces, idempotence);

    const ctx: ContexteTenant = {
      tenantId: options.tenantId,
      utilisateurId: idMagasinier,
      requeteId: null,
    };
    // `magasinier` : seul rôle de démo qui reçoit `pieces.mouvement.creer`/
    // `pieces.reservation.satisfaire` (voir la note de tête de `seed-dev.ts` sur ce compte) —
    // ce paramètre ne fait QUE projeter la réponse (masquage éventuel par rôle), l'autorisation
    // elle-même reste portée par `@ExigerDroit`/`GardeDroit`, jamais exercés par ce script.
    const role: RoleUtilisateur = 'magasinier';

    const idsArticlesParReference = new Map<string, string>();
    const idsSitesParCode = new Map<string, string>([
      ['SION', idSion],
      ['MARTIGNY', idMartigny],
    ]);
    const clesAjustementParReferenceEtSite: Readonly<
      Record<string, Readonly<Record<string, string>>>
    > = {
      GDB1330DTE: { SION: CLE_AJUST_PLAQUETTES_SION, MARTIGNY: CLE_AJUST_PLAQUETTES_MARTIGNY },
      OC90: { SION: CLE_AJUST_FILTRE_SION, MARTIGNY: CLE_AJUST_FILTRE_MARTIGNY },
      'CASTROL-EDGE-5W30-5L': { SION: CLE_AJUST_HUILE_SION, MARTIGNY: CLE_AJUST_HUILE_MARTIGNY },
      'BOSCH-AEROTWIN-A863S': { SION: CLE_AJUST_BALAIS_SION, MARTIGNY: CLE_AJUST_BALAIS_MARTIGNY },
    };
    const clesCreationParReference: Readonly<Record<string, string>> = {
      GDB1330DTE: CLE_ARTICLE_PLAQUETTES,
      OC90: CLE_ARTICLE_FILTRE_HUILE,
      'CASTROL-EDGE-5W30-5L': CLE_ARTICLE_HUILE_5W30,
      'BOSCH-AEROTWIN-A863S': CLE_ARTICLE_BALAIS_ESSUIE,
    };

    for (const a of ARTICLES_DEMO) {
      // Idempotence "vraie" (`ServiceIdempotence`) pour la création, MAIS un rejeu de ce script
      // n'a aucune garantie de repasser par le MÊME processus Node (donc la même mémorisation en
      // base est la seule protection réelle) : on retrouve aussi l'article par sa référence
      // (unique en pratique, RP-03) si l'idempotence avait expiré entre deux exécutions.
      const existant = await acces.enTenant(ctx, (tx) =>
        tx
          .select({ id: articleTable.id })
          .from(articleTable)
          .where(
            and(
              eq(articleTable.tenantId, options.tenantId),
              eq(articleTable.referencePrincipale, a.reference),
            ),
          )
          .limit(1),
      );

      let articleId = existant[0]?.id;
      if (articleId === undefined) {
        const entree: EntreeCreationArticle = {
          designation: a.designation,
          marque: a.marque,
          categorie: a.categorie,
          referencePrincipale: a.reference,
          codeBarres: null,
          prixVenteTtcCentimes: a.prixVenteTtcCentimes,
          tauxTvaPourmille: a.tauxTvaPourmille,
          estEchangeStandard: false,
          montantConsigneTtcCentimes: null,
        };
        const cle = clesCreationParReference[a.reference];
        if (!cle)
          throw new Error(`seed-pieces-demo : aucune clé d'idempotence pour « ${a.reference} ».`);
        const resultat = await serviceArticle.creer(ctx, role, entree, cle);
        articleId = resultat.reponse.corps.donnees.id;
      }
      idsArticlesParReference.set(a.reference, articleId);

      for (const [codeSite, parametresStock] of Object.entries(a.stocks)) {
        const idSite = idsSitesParCode.get(codeSite);
        if (!idSite) throw new Error(`seed-pieces-demo : site « ${codeSite} » introuvable.`);

        const entreeStock: EntreeModificationStockSite = {
          emplacement: parametresStock.emplacement,
          stockMinimumMillieme: parametresStock.stockMinimumMillieme,
          quantiteCommandeStandardMillieme: parametresStock.quantiteCommandeStandardMillieme,
        };
        await serviceStock.modifierSite(ctx, articleId, idSite, entreeStock);

        const cleAjustement = clesAjustementParReferenceEtSite[a.reference]?.[codeSite];
        if (!cleAjustement) {
          throw new Error(
            `seed-pieces-demo : aucune clé d'idempotence d'ajustement pour « ${a.reference} »/« ${codeSite} ».`,
          );
        }
        // Comptage d'ouverture : la SEULE façon légitime de poser un stock physique initial
        // (RP-29) — le serveur calcule lui-même le delta depuis le physique courant (0 au premier
        // passage), donc un rejeu à quantité inchangée ne crée aucun second mouvement (delta = 0,
        // `ServiceMouvement.ajustementInventaire` rend alors `donnees: null` sans écrire).
        await serviceMouvement.ajustementInventaire(
          ctx,
          role,
          articleId,
          {
            siteId: idSite,
            quantiteCompteeMillieme: parametresStock.compteMillieme,
            motif: 'Comptage de stock d’ouverture (jeu de démonstration)',
          },
          cleAjustement,
        );
      }

      journaliser(
        `  article ${a.reference} — ${a.designation} (SION ${String(a.stocks.SION.compteMillieme / 1000)}, MARTIGNY ${String(a.stocks.MARTIGNY.compteMillieme / 1000)}${
          a.stocks.MARTIGNY.compteMillieme < a.stocks.MARTIGNY.stockMinimumMillieme
            ? ' — SOUS SEUIL'
            : ''
        })`,
      );
    }

    // Une sortie comptoir directe (vente pièce détachée, sans OR ni document de vente) —
    // démontre que RP-16/RP-18 fonctionnent dès le jeu de démo, pas seulement les réservations
    // exercées via l'OR Octavia (`seed-atelier-demo.ts`).
    const idFiltre = idsArticlesParReference.get('OC90');
    if (!idFiltre)
      throw new Error('seed-pieces-demo : article « OC90 » introuvable après création.');
    const entreeSortie: EntreeCreationMouvementSortieComptoir = {
      siteId: idSion,
      quantiteMillieme: 1_000,
      motif: 'Vente comptoir directe — client de passage',
    };
    await serviceMouvement.sortieComptoir(
      ctx,
      role,
      idFiltre,
      entreeSortie,
      CLE_SORTIE_COMPTOIR_FILTRE,
    );
    journaliser(`  sortie comptoir — 1 filtre à huile (SION)`);

    return { idsArticlesParReference };
  } finally {
    await acces.onModuleDestroy();
  }
}
