import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';

import { ServiceTableauBordFinancier } from './service-tableau-bord-financier';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

/**
 * Aplatit récursivement les fragments LITTÉRAUX d'un objet `sql` de drizzle-orm (les
 * `StringChunk` — leur `.value: string[]`, y compris ceux imbriqués dans un sous-`sql`
 * comme `filtreSiteDocument`/`filtreSitePaiement`) en une seule chaîne, EN EXCLUANT les
 * valeurs de paramètres interpolées (elles apparaissent comme chaînes NUES dans
 * `queryChunks`, jamais comme objet `{ value: [...] }` — donc ignorées par ce filtre sur
 * `typeof === 'object'`). Sert uniquement à des assertions sur la FORME du SQL généré
 * (quels alias/quelles clauses sont présents), jamais sur son résultat — cette dernière
 * preuve n'est obtenable qu'en exécution réelle (voir la preuve manuelle contre `dfa_dev`
 * référencée dans les tests ci-dessous, aucun mock ne peut la remplacer, CONTRIBUTING.md).
 */
function texteSqlLitteral(chunk: unknown): string {
  if (chunk && typeof chunk === 'object') {
    const c = chunk as { value?: unknown; queryChunks?: unknown };
    if (Array.isArray(c.value)) return c.value.join('');
    if (Array.isArray(c.queryChunks)) return c.queryChunks.map(texteSqlLitteral).join('');
  }
  return '';
}

function texteRequete(execute: ReturnType<typeof vi.fn>): string {
  const requete = execute.mock.calls[0]?.[0] as { queryChunks: readonly unknown[] } | undefined;
  if (!requete) throw new Error('tx.execute jamais appelé — impossible d’inspecter le SQL.');
  return requete.queryChunks.map(texteSqlLitteral).join('');
}

const LIGNE_VIDE = {
  totalHtCentimes: '0',
  totalTvaCentimes: '0',
  totalTtcCentimes: '0',
  nombreDocuments: 0,
  encaissementsCentimes: '0',
  encoursClientsCentimes: '0',
  margeVehiculesCentimes: '0',
  nombreVehiculesFactures: 0,
  stockValeurCentimes: '0',
  stockArticlesValeurInconnueNombre: 0,
};

/** `marges.pieces`/`marges.mainOeuvre` attendus sur CHAQUE réponse, quelles que soient les données
 *  — jamais un montant, voir `MargeIndisponibleTableauBord` (`@dfa/shared`). */
const MARGES_INDISPONIBLES_ATTENDUES = {
  pieces: { disponible: false, raisonCle: 'piecesCoutNonFiable' },
  mainOeuvre: { disponible: false, raisonCle: 'mainOeuvreCoutAbsent' },
};

function accesFactice(ligne: Record<string, unknown> | null) {
  const execute = vi.fn(() => Promise.resolve({ rows: ligne ? [ligne] : [] }));
  const tx = { execute } as unknown as TransactionDfa;
  const enTenant = vi.fn((_ctx: ContexteTenant, travail: (tx: TransactionDfa) => unknown) =>
    Promise.resolve(travail(tx)),
  );
  const acces = { enTenant, verifierConnexion: vi.fn(), verifierPostureRls: vi.fn() } as AccesBase;
  return { acces, execute, enTenant };
}

/**
 * L'autorisation par rôle (`tableau_bord.financier.lire`, `auth/matrice-droits.ts` — `direction`/
 * `comptable` SEULS, `admin` explicitement exclu, RF-115) N'EST PLUS testée ici : elle est portée
 * EXCLUSIVEMENT par `@ExigerDroit('tableau_bord.financier.lire')` + `GardeDroit` sur
 * `TableauBordFinancierController` (bascule depuis le palliatif `tableau-bord/droits-provisoires.ts`,
 * retiré — voir le commentaire de tête de `service-tableau-bord-financier.ts`). Le guard refuse
 * `403 DROIT_INSUFFISANT` en `canActivate()`, AVANT que ce handler (donc `service.obtenir()`, donc
 * la moindre requête d'agrégation financière) ne s'exécute — structurellement, pas par un test de ce
 * service. Cette garantie est couverte par :
 *  - `auth/matrice-droits.spec.ts` (le rôle→action est correct : direction/comptable seuls, admin
 *    explicitement exclu par un test dédié RF-115) ;
 *  - `common/droits/garde-droit.spec.ts` (le guard refuse bien AVANT le handler quand l'action
 *    manque, générique à toute action) ;
 *  - `common/droits/toutes-les-actions-couvertes.spec.ts` (`@ExigerDroit('tableau_bord.financier.
 *    lire')` est bien posé sur une route réellement montée).
 * Ce service n'a donc plus de rôle à recevoir : il interroge la base pour tout appelant, l'appel
 * lui-même étant conditionné par le guard en amont.
 */
describe('ServiceTableauBordFinancier.obtenir — interroge toujours la base (l’autorisation est au guard, pas ici)', () => {
  it('appelle bien la base (aucun filtrage par rôle en service)', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    await service.obtenir(CTX, {});

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('ServiceTableauBordFinancier.obtenir — période vide : zéro partout, jamais une exception', () => {
  it('aucun document/paiement sur la période : tous les montants à 0', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {
      du: '2026-01-01',
      au: '2026-01-01',
    });

    expect(resultat.chiffreAffaires).toEqual({
      totalHtCentimes: 0,
      totalTvaCentimes: 0,
      totalTtcCentimes: 0,
      nombreDocuments: 0,
    });
    expect(resultat.encaissementsCentimes).toBe(0);
    expect(resultat.encoursClientsCentimes).toBe(0);
    // Marge véhicules : zéro DIGNE (aucun véhicule vendu = vraie donnée), pas une absence.
    expect(resultat.marges.vehicules).toEqual({ margeCentimes: 0, nombreVehiculesFactures: 0 });
    // Marge pièces/main-d'œuvre : JAMAIS un montant, même à 0 — voir le test dédié plus bas.
    expect(resultat.marges.pieces).toEqual(MARGES_INDISPONIBLES_ATTENDUES.pieces);
    expect(resultat.marges.mainOeuvre).toEqual(MARGES_INDISPONIBLES_ATTENDUES.mainOeuvre);
    expect(resultat.stockPieces).toEqual({ totalCentimes: 0, articlesValeurInconnueNombre: 0 });
  });
});

describe('ServiceTableauBordFinancier.obtenir — marge véhicules : distincte de la marge pièces/main-d’œuvre, jamais un montant fabriqué', () => {
  it('marge véhicules positive : revenu HT − coût d’acquisition verrouillé, arithmétique exacte', async () => {
    const ligne = { ...LIGNE_VIDE, margeVehiculesCentimes: '345000', nombreVehiculesFactures: 2 };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {});

    expect(resultat.marges.vehicules).toEqual({
      margeCentimes: 345000,
      nombreVehiculesFactures: 2,
    });
  });

  it('marge véhicules NÉGATIVE (vente à perte) : traverse exactement, jamais plafonnée à 0 — même doctrine que le CA net d’avoirs', async () => {
    const ligne = { ...LIGNE_VIDE, margeVehiculesCentimes: '-125000', nombreVehiculesFactures: 1 };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {});

    expect(resultat.marges.vehicules.margeCentimes).toBe(-125000);
  });

  it('marge pièces et main-d’œuvre : TOUJOURS `{ disponible: false, raisonCle }`, quelles que soient les données SQL renvoyées — jamais dérivées d’une colonne, jamais un montant à 0', async () => {
    const ligne = { ...LIGNE_VIDE, margeVehiculesCentimes: '999999', nombreVehiculesFactures: 5 };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {});

    expect(resultat.marges.pieces).toEqual(MARGES_INDISPONIBLES_ATTENDUES.pieces);
    expect(resultat.marges.mainOeuvre).toEqual(MARGES_INDISPONIBLES_ATTENDUES.mainOeuvre);
    // Distinction structurelle avec la marge véhicules : jamais de `margeCentimes`/`montantCentimes`
    // sur la branche indisponible — un test qui lirait `(resultat.marges.pieces as any).montantCentimes`
    // ne trouverait rien à lire, par construction du type (`MargeIndisponibleTableauBord`).
    expect('margeCentimes' in resultat.marges.pieces).toBe(false);
    expect('montantCentimes' in resultat.marges.pieces).toBe(false);
  });
});

describe('ServiceTableauBordFinancier.obtenir — valorisation du stock pièces : distincte de « zéro », exclut les articles sans prix connu', () => {
  it('stock valorisé + articles à valeur inconnue : deux champs distincts, arithmétique exacte', async () => {
    const ligne = {
      ...LIGNE_VIDE,
      stockValeurCentimes: '1875000',
      stockArticlesValeurInconnueNombre: 4,
    };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {});

    expect(resultat.stockPieces).toEqual({
      totalCentimes: 1875000,
      articlesValeurInconnueNombre: 4,
    });
  });

  it('stock entièrement valorisable (aucun article à valeur inconnue) : `articlesValeurInconnueNombre` à 0, un ZÉRO digne, pas une absence', async () => {
    const ligne = {
      ...LIGNE_VIDE,
      stockValeurCentimes: '50000',
      stockArticlesValeurInconnueNombre: 0,
    };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {});

    expect(resultat.stockPieces.articlesValeurInconnueNombre).toBe(0);
    expect(resultat.stockPieces.totalCentimes).toBe(50000);
  });
});

describe('ServiceTableauBordFinancier.obtenir — arithmétique exacte (bigint texte → number, jamais un flottant)', () => {
  it('convertit les sommes SQL (texte, précision arbitraire côté pilote pg) en number EXACT, sans arrondi', async () => {
    const ligne = {
      // Valeurs volontairement non rondes et non ambiguës en flottant IEEE754, pour prouver
      // l'absence d'arrondi (12345678.90 CHF en centimes → un entier qui n'a AUCUNE représentation
      // flottante approximative à surveiller ici, contrairement à un calcul en francs).
      totalHtCentimes: '1234567890',
      totalTvaCentimes: '99999999',
      totalTtcCentimes: '1334567889',
      nombreDocuments: 42,
      encaissementsCentimes: '1000000000',
      encoursClientsCentimes: '334567889',
    };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {
      du: '2026-08-01',
      au: '2026-08-04',
    });

    expect(resultat.chiffreAffaires).toEqual({
      totalHtCentimes: 1_234_567_890,
      totalTvaCentimes: 99_999_999,
      totalTtcCentimes: 1_334_567_889,
      nombreDocuments: 42,
    });
    expect(resultat.encaissementsCentimes).toBe(1_000_000_000);
    expect(resultat.encoursClientsCentimes).toBe(334_567_889);
    // HT + TVA = TTC, exactement (pas de `toBeCloseTo` sur de l'argent, CONTRIBUTING.md).
    expect(
      resultat.chiffreAffaires.totalHtCentimes + resultat.chiffreAffaires.totalTvaCentimes,
    ).toBe(resultat.chiffreAffaires.totalTtcCentimes);
  });

  it('net des avoirs (déjà négatifs en base) : une somme négative traverse exactement, sans être redressée à 0', async () => {
    const ligne = {
      ...LIGNE_VIDE,
      // Un mois où les avoirs émis dépassent les factures émises : net négatif, cas réel et
      // légitime (RF-11→18) — ne doit JAMAIS être silencieusement plafonné à 0.
      totalHtCentimes: '-500',
      totalTvaCentimes: '-40',
      totalTtcCentimes: '-540',
      nombreDocuments: 3,
    };
    const { acces } = accesFactice(ligne);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, {});

    expect(resultat.chiffreAffaires.totalHtCentimes).toBe(-500);
    expect(resultat.chiffreAffaires.totalTtcCentimes).toBe(-540);
  });

  it('siteId transmis : renvoyé tel quel dans la réponse', async () => {
    const { acces } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    const resultat = await service.obtenir(CTX, { siteId: 'site-42' });

    expect(resultat.siteId).toBe('site-42');
  });
});

/**
 * VERROU DE FORME — la fusion des quatre sous-requêtes HT/TVA/TTC/nombreDocuments en une
 * seule CTE (`with documents_periode as (...)`, migration de perf de cette itération) a été
 * prouvée ÉQUIVALENTE à l'ancienne forme (git history) en EXÉCUTION RÉELLE contre `dfa_dev`
 * (jamais depuis un test — CONTRIBUTING.md interdit de pointer les tests sur `dfa_dev`), sur huit
 * scénarios : tenant sans document, période vide, filtre par site (SION/MARTIGNY), facture
 * intégralement annulée par un avoir (nette à zéro sur la fenêtre qui encadre les deux), et
 * facture au solde nul incluse dans `encoursClientsCentimes` sans être perdue. Résultats
 * OLD/NEW identiques, valeur à valeur, sur les huit — voir le rapport de vérification de ce
 * chantier pour le détail des requêtes et des données de test.
 *
 * Un mock de `tx.execute` ne peut PAS reproduire cette preuve (il ne prouve que la
 * logique JS autour de la requête, jamais la requête elle-même — piège documenté). Ce que ces
 * tests verrouillent, plus modestement mais réellement utile : la FORME du SQL envoyé —
 * qu'une régression future ne recolle pas silencieusement `d.site_id`/`p.site_id`/`s.site_id`
 * (bug réel rencontré en écrivant le harnais de preuve manuelle : les alias sont FACILEMENT
 * confondus) et que le filtrage tenant reste explicite dans le texte de la requête, jamais
 * délégué au seul RLS (RLS = le filet, pas le mécanisme, CONTRIBUTING.md) — c'est aussi la preuve
 * d'ISOLATION TENANT exigée pour ce lot au niveau unitaire : la preuve en EXÉCUTION réelle contre
 * une base multi-tenant relève de `pnpm test:integration`, hors périmètre ici (CONTRIBUTING.md).
 *
 * ÉTENDU le 14.08.2026 (marge véhicules, valorisation stock pièces) : `vehicules_periode` (CTE
 * sœur de `documents_periode`, filtre différent — jointure `vehicule_stock` + `vehicule_id is not
 * null`, ne fusionne donc PAS avec elle) et deux sous-requêtes scalaires sur `stock_article`/
 * `article` (mêmes garanties qu'`encaissementsCentimes`/`encoursClientsCentimes` : filtre propre,
 * non fusionnable).
 */
describe('ServiceTableauBordFinancier.obtenir — forme SQL de la CTE fusionnée (documents_periode) + marge véhicules + stock pièces (14.08.2026)', () => {
  it('scope tenant_id EXPLICITEMENT dans le texte du SQL — sur les SIX familles de filtre (documents, véhicules, paiements, encours, stock valorisé, stock à valeur inconnue) ET sur les jointures qui les scopent, jamais seulement via RLS', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    await service.obtenir(CTX, {});

    const texte = texteRequete(execute);
    // Neuf occurrences : une par WHERE (documents_periode, vehicules_periode, paiement, encours,
    // stock valorisé, stock à valeur inconnue = 6, chacune reçoit ctx.tenantId indépendamment du
    // RLS) + une par JOIN qui scope une table SECONDAIRE sur le tenant de la table pilote plutôt
    // que sur le RLS seul (`vs.tenant_id = d.tenant_id` dans vehicules_periode, `a.tenant_id =
    // s.tenant_id` dans CHACUNE des deux sous-requêtes stock = 3). Passé de 3 (avant marge/stock)
    // à 9 avec ce lot — bump délibéré, pas un relâchement : chaque nouvelle table jointe DOIT
    // porter sa propre condition de scoping tenant, sinon elle repose sur le RLS seul (piège
    // documenté, CONTRIBUTING.md — même doctrine que `ligne_or l join ordre_reparation o on o.tenant_id
    // = l.tenant_id` dans `service-tableau-bord-activite.ts`).
    const occurrences = texte.split('tenant_id =').length - 1;
    expect(occurrences).toBe(9);
  });

  it('sans siteId : ni d.site_id, ni p.site_id, ni s.site_id dans le SQL (les trois filtres restent absents ensemble)', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    await service.obtenir(CTX, {});

    const texte = texteRequete(execute);
    expect(texte).not.toContain('d.site_id');
    expect(texte).not.toContain('p.site_id');
    expect(texte).not.toContain('s.site_id');
  });

  it('avec siteId : d.site_id, p.site_id ET s.site_id présents SÉPARÉMENT — jamais le même alias appliqué à deux tables', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    await service.obtenir(CTX, { siteId: 'site-42' });

    const texte = texteRequete(execute);
    expect(texte).toContain('d.site_id =');
    expect(texte).toContain('p.site_id =');
    expect(texte).toContain('s.site_id =');
    // d.site_id : documents_periode + vehicules_periode + encours = 3 (était 2 avant
    // vehicules_periode, bump délibéré). p.site_id : paiements seul = 1, inchangé. s.site_id :
    // stock valorisé + stock à valeur inconnue = 2 (nouveau). Si un futur refactor en perd un
    // seul, ce compte bouge.
    expect(texte.split('d.site_id =').length - 1).toBe(3);
    expect(texte.split('p.site_id =').length - 1).toBe(1);
    expect(texte.split('s.site_id =').length - 1).toBe(2);
  });

  it('un seul balayage de document_vente pour HT/TVA/TTC/nombreDocuments : la CTE documents_periode existe et regroupe les quatre agrégats', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    await service.obtenir(CTX, {});

    const texte = texteRequete(execute);
    expect(texte).toContain('with documents_periode as');
    expect(texte).toContain('vehicules_periode as');
    // Les quatre agrégats CA vivent TOUS dans `documents_periode` (un seul scan). `vehicules_periode`
    // (marge véhicules) a un filtre DIFFÉRENT (jointure `vehicule_stock` + `vehicule_id is not
    // null`) et ne peut donc pas fusionner avec la CTE ci-dessus — un second scan dédié, réel et
    // attendu. La sous-requête d'encours (filtre encore différent) en ajoute un troisième :
    // 3 scans au total, jamais 4 (aucune sous-requête corrélée redondante), jamais 2 (la marge
    // véhicules n'a pas été oubliée).
    const scansDocumentVente = texte.split('from public.document_vente').length - 1;
    expect(scansDocumentVente).toBe(3);
  });

  it('la valorisation du stock pièces joint bien `article` (prix) à `stock_article` (quantité), articles ACTIFS seulement, jamais un article archivé', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    await service.obtenir(CTX, {});

    const texte = texteRequete(execute);
    expect(texte).toContain('from public.stock_article s');
    expect(texte).toContain("a.statut = 'actif'");
    // Deux occurrences de la jointure article : valorisation (prix connu) + comptage (prix
    // inconnu) — les DEUX branches filtrent sur les articles actifs.
    expect(texte.split("a.statut = 'actif'").length - 1).toBe(2);
  });

  it('la marge véhicules joint `vehicule_stock` sur `document_vente.vehicule_id`, exclut les documents sans véhicule', async () => {
    const { acces, execute } = accesFactice(LIGNE_VIDE);
    const service = new ServiceTableauBordFinancier(acces);

    await service.obtenir(CTX, {});

    const texte = texteRequete(execute);
    expect(texte).toContain('join public.vehicule_stock vs');
    expect(texte).toContain('vs.id = d.vehicule_id');
    expect(texte).toContain('d.vehicule_id is not null');
  });
});
