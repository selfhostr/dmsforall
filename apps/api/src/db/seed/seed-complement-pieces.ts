/**
 * Jeu de démonstration « complet » — pièces et stock : fournisseurs, catalogue d'articles,
 * références croisées, stock par site, mouvements, réservations, commandes fournisseur (brouillon,
 * envoyée, partiellement reçue, reçue, clôturée, annulée), factures fournisseur, stock bas.
 *
 * Le stock physique de chaque couple (article, site) est TOUJOURS la somme des mouvements posés :
 * entrées de livraison, sorties vers les OR, casse, ajustements d'inventaire.
 */
import { createHash, randomUUID } from 'node:crypto';
import { choisir, entre, ins, jour, sql, tvaDe, type Ctx } from './seed-complement-outils';
import type { ArticleDemo, ResultatAtelier } from './seed-complement-atelier';

const FOURNISSEURS: ReadonlyArray<[string, string, string, number]> = [
  ['Autoteile Müller AG', 'commandes@mueller-autoteile.ch', '+41442001122', 1],
  ['Valais Pièces Auto SA', 'commandes@valaispieces.ch', '+41273221100', 1],
  ['Pneus Romandie Sàrl', 'vente@pneus-romandie.ch', '+41218001234', 2],
  ['Lubrifiants Alpins SA', 'info@lubalpins.ch', '+41273000011', 3],
  ['Carrosserie Service Léman', 'pieces@carrosserie-leman.ch', '+41216214455', 4],
  ['Batteries Suisse Centrale AG', 'bestellung@batterien-sz.ch', '+41412003344', 2],
];

interface SpecArticle {
  ref: string;
  des: string;
  marque: string;
  cat: string;
  achat: number;
  vente: number;
  min: number;
}
const ARTICLES: readonly SpecArticle[] = [
  {
    ref: 'BOSCH-0986-AB1',
    des: 'Plaquettes de frein avant Bosch',
    marque: 'Bosch',
    cat: 'piece_mecanique',
    achat: 3800,
    vente: 6900,
    min: 4,
  },
  {
    ref: 'ATE-24012-DSK',
    des: 'Disques de frein avant ventilés (paire)',
    marque: 'ATE',
    cat: 'piece_mecanique',
    achat: 7200,
    vente: 12900,
    min: 2,
  },
  {
    ref: 'MANN-W7008',
    des: 'Filtre à huile Mann-Filter',
    marque: 'Mann-Filter',
    cat: 'piece_mecanique',
    achat: 520,
    vente: 1400,
    min: 10,
  },
  {
    ref: 'MANN-C27009',
    des: 'Filtre à air Mann-Filter',
    marque: 'Mann-Filter',
    cat: 'piece_mecanique',
    achat: 900,
    vente: 2300,
    min: 6,
  },
  {
    ref: 'MANN-CU2939',
    des: 'Filtre d’habitacle charbon actif',
    marque: 'Mann-Filter',
    cat: 'piece_mecanique',
    achat: 780,
    vente: 2100,
    min: 6,
  },
  {
    ref: 'NGK-BKR6E',
    des: 'Bougies d’allumage NGK (jeu de 4)',
    marque: 'NGK',
    cat: 'piece_mecanique',
    achat: 1800,
    vente: 4200,
    min: 4,
  },
  {
    ref: 'VARTA-E11-70',
    des: 'Batterie Varta 12 V 70 Ah',
    marque: 'Varta',
    cat: 'piece_mecanique',
    achat: 9800,
    vente: 16500,
    min: 3,
  },
  {
    ref: 'LUK-624-3303',
    des: 'Kit d’embrayage LuK 3 pièces',
    marque: 'LuK',
    cat: 'piece_mecanique',
    achat: 28500,
    vente: 46500,
    min: 1,
  },
  {
    ref: 'GATES-K015607',
    des: 'Kit de distribution Gates avec pompe à eau',
    marque: 'Gates',
    cat: 'piece_mecanique',
    achat: 21000,
    vente: 36000,
    min: 1,
  },
  {
    ref: 'SACHS-AMORT-AV',
    des: 'Amortisseur avant Sachs',
    marque: 'Sachs',
    cat: 'piece_mecanique',
    achat: 6500,
    vente: 11800,
    min: 2,
  },
  {
    ref: 'CASTROL-5W30-1L',
    des: 'Huile moteur Castrol Edge 5W30 — 1 L',
    marque: 'Castrol',
    cat: 'lubrifiant',
    achat: 1100,
    vente: 2400,
    min: 20,
  },
  {
    ref: 'TOTAL-5W40-5L',
    des: 'Huile moteur Total Quartz 5W40 — 5 L',
    marque: 'Total',
    cat: 'lubrifiant',
    achat: 3900,
    vente: 7900,
    min: 6,
  },
  {
    ref: 'LIQ-FREIN-DOT4',
    des: 'Liquide de frein DOT 4 — 1 L',
    marque: 'Motul',
    cat: 'lubrifiant',
    achat: 800,
    vente: 1900,
    min: 6,
  },
  {
    ref: 'LIQ-REFR-5L',
    des: 'Liquide de refroidissement G12 — 5 L',
    marque: 'Glysantin',
    cat: 'lubrifiant',
    achat: 1500,
    vente: 3400,
    min: 6,
  },
  {
    ref: 'MICH-PS4-2055516',
    des: 'Pneu Michelin Pilot Sport 4 205/55 R16',
    marque: 'Michelin',
    cat: 'pneu',
    achat: 11800,
    vente: 15900,
    min: 8,
  },
  {
    ref: 'CONTI-WC-2054517',
    des: 'Pneu hiver Continental WinterContact 205/45 R17',
    marque: 'Continental',
    cat: 'pneu',
    achat: 12900,
    vente: 17500,
    min: 8,
  },
  {
    ref: 'PIRELLI-WS-2256017',
    des: 'Pneu hiver Pirelli Sottozero 225/60 R17',
    marque: 'Pirelli',
    cat: 'pneu',
    achat: 14200,
    vente: 19500,
    min: 8,
  },
  {
    ref: 'BRIDG-T005-1956515',
    des: 'Pneu été Bridgestone Turanza 195/65 R15',
    marque: 'Bridgestone',
    cat: 'pneu',
    achat: 8800,
    vente: 12900,
    min: 8,
  },
  {
    ref: 'BALAI-BOSCH-A863S',
    des: 'Balais d’essuie-glace Bosch Aerotwin',
    marque: 'Bosch',
    cat: 'fourniture',
    achat: 1700,
    vente: 3600,
    min: 8,
  },
  {
    ref: 'AMPOULE-H7',
    des: 'Ampoule H7 55 W (paire)',
    marque: 'Osram',
    cat: 'fourniture',
    achat: 1200,
    vente: 2800,
    min: 6,
  },
  {
    ref: 'CLIM-R134A-500',
    des: 'Gaz réfrigérant R134a 500 g',
    marque: 'Sun',
    cat: 'fourniture',
    achat: 1800,
    vente: 3900,
    min: 4,
  },
  {
    ref: 'COURROIE-ACC-6PK',
    des: 'Courroie d’accessoires 6PK Contitech',
    marque: 'Contitech',
    cat: 'piece_mecanique',
    achat: 2400,
    vente: 5200,
    min: 3,
  },
  {
    ref: 'NETTOYANT-FREIN',
    des: 'Nettoyant freins 500 ml',
    marque: 'Würth',
    cat: 'produit_atelier',
    achat: 450,
    vente: 1100,
    min: 12,
  },
  {
    ref: 'GRAISSE-CUIVRE',
    des: 'Pâte au cuivre 100 g',
    marque: 'Würth',
    cat: 'produit_atelier',
    achat: 600,
    vente: 1500,
    min: 4,
  },
  {
    ref: 'PARE-CHOC-AR-GOLF',
    des: 'Pare-chocs arrière Golf 7 (à peindre)',
    marque: 'VW',
    cat: 'piece_carrosserie',
    achat: 18500,
    vente: 29900,
    min: 1,
  },
  {
    ref: 'RETRO-G-GOLF',
    des: 'Rétroviseur extérieur gauche Golf 7',
    marque: 'VW',
    cat: 'piece_carrosserie',
    achat: 9400,
    vente: 16800,
    min: 1,
  },
  {
    ref: 'ALTERNATEUR-ECH',
    des: 'Alternateur 140 A — échange standard',
    marque: 'Bosch',
    cat: 'piece_mecanique',
    achat: 21000,
    vente: 38900,
    min: 1,
  },
  {
    ref: 'DEMARREUR-ECH',
    des: 'Démarreur — échange standard',
    marque: 'Valeo',
    cat: 'piece_mecanique',
    achat: 17500,
    vente: 32000,
    min: 1,
  },
];

export interface ResultatPieces {
  readonly articles: ArticleDemo[];
  readonly fournisseurs: string[];
}

export async function semerCataloguePieces(ctx: Ctx): Promise<ResultatPieces> {
  const magasinier = ctx.utilisateurs.get('magasinier') ?? null;
  await ins(ctx, 'parametre_pieces', {}, { sansId: true });

  const fournisseurs: string[] = [];
  for (const [nom, email, telephone, delai] of FOURNISSEURS) {
    fournisseurs.push(
      await ins(ctx, 'fournisseur', {
        nom,
        email,
        telephone,
        delaiHabituelJours: delai,
        statut: 'actif',
        origine: 'dfa',
      }),
    );
  }
  await ins(ctx, 'fournisseur', {
    nom: 'Ancien grossiste Rhône (inactif)',
    email: 'info@ancien-grossiste.ch',
    telephone: '+41273001122',
    delaiHabituelJours: 5,
    statut: 'inactif',
    origine: 'dfa',
  });

  const articles: ArticleDemo[] = [];
  const idsParRef = new Map<string, string>();
  for (const a of ARTICLES) {
    const echange = a.ref.endsWith('-ECH');
    const id = await ins(ctx, 'article', {
      designation: a.des,
      marque: a.marque,
      categorie: a.cat,
      statut: 'actif',
      referencePrincipale: a.ref,
      prixAchatCentimes: a.achat,
      prixVenteTtcCentimes: a.vente,
      tauxTvaPourmille: 81,
      estEchangeStandard: echange,
      montantConsigneTtcCentimes: echange ? 8000 : null,
      origine: 'dfa',
    });
    idsParRef.set(a.ref, id);
    articles.push({
      id,
      reference: a.ref,
      designation: a.des,
      categorie: a.cat,
      prixCentimes: a.vente,
    });
    for (const code of ['SION', 'MARTIGNY']) {
      const siteId = ctx.sites.get(code);
      if (!siteId) continue;
      const initial =
        (a.cat === 'pneu'
          ? entre(ctx, 8, 24)
          : a.min >= 10
            ? entre(ctx, 25, 60)
            : entre(ctx, 6, 14)) * 1000;
      await ins(
        ctx,
        'stock_article',
        {
          articleId: id,
          siteId,
          quantitePhysiqueMillieme: 0,
          quantiteReserveeMillieme: 0,
          emplacement: `${code === 'SION' ? 'S' : 'M'}-${a.cat === 'pneu' ? 'PNEUS' : 'MAG'}`,
          stockMinimumMillieme: a.min * 1000,
          quantiteCommandeStandardMillieme: Math.max(2, a.min * 2) * 1000,
          rayon: String.fromCharCode(65 + entre(ctx, 0, 5)),
          tiroir: String(entre(ctx, 1, 12)),
        },
        { sansId: true },
      );
      await ins(ctx, 'mouvement_stock', {
        articleId: id,
        type: 'entree_livraison',
        quantiteMillieme: initial,
        siteId,
        prixAchatReelCentimes: a.achat,
        auteurId: magasinier,
        creeLe: jour(ctx, -60, 9),
      });
    }
  }
  // Références croisées
  const refs: Array<[string, string, string]> = [
    ['MANN-W7008', 'equivalente', 'BOSCH-F026407006'],
    ['BOSCH-0986-AB1', 'equivalente', 'TRW-GDB1330'],
    ['CASTROL-5W30-1L', 'remplace_par', 'CASTROL-EDGE-5W30-1L-NEW'],
    ['MICH-PS4-2055516', 'fournisseur', 'MICH-3528703'],
    ['NGK-BKR6E', 'equivalente', 'DENSO-K20PR-U'],
    ['VARTA-E11-70', 'fournisseur', 'VARTA-570144064'],
  ];
  for (const [ref, type, reference] of refs) {
    const articleId = idsParRef.get(ref);
    if (articleId)
      await ins(ctx, 'article_reference', {
        articleId,
        type,
        reference,
        fournisseurId: type === 'fournisseur' ? fournisseurs[0] : null,
      });
  }
  // Inclut les articles du seed historique (pièces) pour les lignes d'OR.
  const existants = await sql<{
    id: string;
    reference_principale: string;
    designation: string;
    categorie: string;
    prix_vente_ttc_centimes: number;
  }>(
    ctx,
    `select id, reference_principale, designation, categorie, prix_vente_ttc_centimes from article where tenant_id = $1`,
    [ctx.tenantId],
  );
  for (const e of existants) {
    if (!articles.some((a) => a.id === e.id)) {
      articles.push({
        id: e.id,
        reference: e.reference_principale,
        designation: e.designation,
        categorie: e.categorie,
        prixCentimes: e.prix_vente_ttc_centimes,
      });
    }
  }
  ctx.journaliser(
    `  ${String(fournisseurs.length + 1)} fournisseurs, ${String(ARTICLES.length)} articles supplémentaires, stock sur les deux sites, références croisées`,
  );
  return { articles, fournisseurs };
}

/** Sorties de stock et réservations découlant des lignes de pièces des OR. */
export async function appliquerStockOr(ctx: Ctx, res: ResultatAtelier): Promise<void> {
  const magasinier = ctx.utilisateurs.get('magasinier') ?? null;
  let sorties = 0;
  let reservations = 0;
  const estConsomme = (l: ResultatAtelier['lignesPieces'][number]): boolean =>
    ['cloture', 'restitue', 'facture', 'termine', 'controle'].includes(l.statutOr) ||
    l.statutLigne === 'realisee';
  const stockDe = async (
    articleId: string,
    siteId: string,
  ): Promise<{ physique: number; reservee: number } | null> => {
    const r = await sql<{ p: number; r: number }>(
      ctx,
      `select quantite_physique_millieme p, quantite_reservee_millieme r from stock_article where tenant_id = $1 and article_id = $2 and site_id = $3`,
      [ctx.tenantId, articleId, siteId],
    );
    return r[0] ? { physique: r[0].p, reservee: r[0].r } : null;
  };

  // Passe 1 : pièces déjà sorties du magasin. Le trigger de réservation (qui réserve le stock à
  // l'insertion) est suspendu : ces réservations naissent déjà « satisfaites », leur sortie est
  // posée juste avant.
  await ctx.c.query(
    'alter table reservation_piece disable trigger reservation_piece_verrouiller_stock',
  );
  for (const l of res.lignesPieces.filter(estConsomme)) {
    const siteId = ctx.sites.get(l.siteCode);
    if (!siteId) continue;
    const s = await stockDe(l.articleId, siteId);
    if (!s || s.physique - s.reservee < l.quantiteMilli) continue;
    const quand = new Date(l.date.getTime() + 3 * 3600_000);
    const mouvementId = await ins(ctx, 'mouvement_stock', {
      articleId: l.articleId,
      type: 'sortie_or',
      quantiteMillieme: -l.quantiteMilli,
      siteId,
      ligneOrId: l.ligneId,
      auteurId: magasinier,
      creeLe: quand,
    });
    await ins(ctx, 'reservation_piece', {
      articleId: l.articleId,
      siteId,
      ligneOrId: l.ligneId,
      ordreReparationId: l.orId,
      quantiteMillieme: l.quantiteMilli,
      statut: 'satisfaite',
      creeLe: l.date,
      satisfaiteLe: quand,
      mouvementSortieId: mouvementId,
    });
    sorties++;
  }
  await ctx.c.query(
    'alter table reservation_piece enable trigger reservation_piece_verrouiller_stock',
  );

  // Passe 2 : pièces réservées pour des OR en cours (le trigger réserve le stock).
  for (const l of res.lignesPieces.filter((x) => !estConsomme(x))) {
    const siteId = ctx.sites.get(l.siteCode);
    if (!siteId) continue;
    const s = await stockDe(l.articleId, siteId);
    if (!s || s.physique - s.reservee < l.quantiteMilli) continue;
    await ins(ctx, 'reservation_piece', {
      articleId: l.articleId,
      siteId,
      ligneOrId: l.ligneId,
      ordreReparationId: l.orId,
      quantiteMillieme: l.quantiteMilli,
      statut: 'active',
      creeLe: l.date,
    });
    reservations++;
  }
  ctx.journaliser(
    `  ${String(sorties)} sorties de stock vers les OR, ${String(reservations)} réservations actives`,
  );
}

/** Commandes fournisseur, factures fournisseur, mouvements divers et stock bas. */
export async function semerCommandesEtStockBas(ctx: Ctx, pieces: ResultatPieces): Promise<void> {
  const magasinier = ctx.utilisateurs.get('magasinier') ?? null;
  const direction = ctx.utilisateurs.get('direction') ?? null;
  const fournisseurs = pieces.fournisseurs;
  const articles = pieces.articles;
  const siteSion = ctx.sites.get('SION');
  const siteMartigny = ctx.sites.get('MARTIGNY');
  if (!siteSion || !siteMartigny) return;

  const specs: Array<{
    statut: string;
    jours: number;
    site: string;
    origine: string;
    nb: number;
    recu: 'rien' | 'partiel' | 'tout';
    motif?: string;
  }> = [
    { statut: 'brouillon', jours: 0, site: siteSion, origine: 'manuelle', nb: 3, recu: 'rien' },
    {
      statut: 'envoyee',
      jours: 2,
      site: siteSion,
      origine: 'reapprovisionnement',
      nb: 4,
      recu: 'rien',
    },
    {
      statut: 'envoyee',
      jours: 1,
      site: siteMartigny,
      origine: 'reservation_rupture',
      nb: 2,
      recu: 'rien',
    },
    {
      statut: 'partiellement_recue',
      jours: 6,
      site: siteMartigny,
      origine: 'manuelle',
      nb: 4,
      recu: 'partiel',
    },
    {
      statut: 'recue',
      jours: 12,
      site: siteSion,
      origine: 'reapprovisionnement',
      nb: 3,
      recu: 'tout',
    },
    { statut: 'cloturee', jours: 40, site: siteSion, origine: 'manuelle', nb: 3, recu: 'tout' },
    {
      statut: 'annulee',
      jours: 25,
      site: siteMartigny,
      origine: 'manuelle',
      nb: 2,
      recu: 'rien',
      motif: 'Article indisponible chez le fournisseur, commandé ailleurs',
    },
  ];
  const commandes: Array<{
    id: string;
    fournisseurId: string;
    lignes: Array<{ id: string; articleId: string; qte: number; prix: number }>;
    statut: string;
  }> = [];
  for (const [k, s] of specs.entries()) {
    const fournisseurId = fournisseurs[k % fournisseurs.length] as string;
    const date = jour(ctx, -s.jours, 10);
    const id = await ins(ctx, 'commande_fournisseur', {
      fournisseurId,
      siteId: s.site,
      statut: s.statut,
      origine: s.origine,
      dateCommande: date.toISOString().slice(0, 10),
      envoyeeLe: s.statut === 'brouillon' ? null : date,
      reference: `CMD-${date.getUTCFullYear()}-${String(k + 1).padStart(3, '0')}`,
      motifAnnulation: s.motif ?? null,
      creeLe: date,
      origineReprise: 'dfa',
    });
    const lignes: Array<{ id: string; articleId: string; qte: number; prix: number }> = [];
    for (let n = 0; n < s.nb; n++) {
      const art = articles[(k * 5 + n * 3) % articles.length];
      if (!art) continue;
      const qte = entre(ctx, 2, 10) * 1000;
      const recue =
        s.recu === 'tout'
          ? qte
          : s.recu === 'partiel' && n % 2 === 0
            ? Math.round(qte / 2000) * 1000
            : 0;
      const prix = Math.round(art.prixCentimes * 0.55);
      const ligneId = await ins(ctx, 'commande_fournisseur_ligne', {
        commandeFournisseurId: id,
        numeroOrdre: n + 1,
        articleId: art.id,
        quantiteCommandeeMillieme: qte,
        quantiteRecueCumuleeMillieme: recue,
        prixAchatAttenduCentimes: prix,
      });
      lignes.push({ id: ligneId, articleId: art.id, qte, prix });
      if (recue > 0) {
        await ins(ctx, 'mouvement_stock', {
          articleId: art.id,
          type: 'entree_livraison',
          quantiteMillieme: recue,
          siteId: s.site,
          prixAchatReelCentimes: prix,
          commandeFournisseurLigneId: ligneId,
          auteurId: magasinier,
          creeLe: jour(ctx, -Math.max(0, s.jours - 2), 11),
        });
      }
    }
    commandes.push({ id, fournisseurId, lignes, statut: s.statut });
  }

  // Factures fournisseur (document PDF minimal + lignes)
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  const statutsFF = ['deposee', 'rapprochee', 'validee', 'rejetee'] as const;
  for (const [k, statut] of statutsFF.entries()) {
    const cmd = commandes[3 + (k % 3)];
    if (!cmd) continue;
    const docId = randomUUID();
    await ins(ctx, 'facture_fournisseur_document', {
      id: docId,
      contenu: pdf,
      typeMime: 'application/pdf',
      tailleOctets: pdf.length,
      empreinteSha256: createHash('sha256').update(pdf).update(String(k)).digest(),
      deposeParId: magasinier,
      deposeLe: jour(ctx, -(10 - k * 2), 14),
    });
    const total = cmd.lignes.reduce((a, l) => a + Math.round((l.qte / 1000) * l.prix), 0);
    const ffId = await ins(ctx, 'facture_fournisseur', {
      documentId: docId,
      fournisseurId: cmd.fournisseurId,
      commandeFournisseurId: cmd.id,
      statut,
      ibanCreancier: 'CH5604835012345678009',
      nomCreancier: 'Fournisseur',
      numeroFacture: `F-2026-${String(4100 + k)}`,
      dateFacture: jour(ctx, -(9 - k))
        .toISOString()
        .slice(0, 10),
      montantTotalCentimes: total,
      devise: 'CHF',
      referencePaiement: null,
      deposeParId: magasinier,
      deposeLe: jour(ctx, -(10 - k * 2), 14),
      valideParId: statut === 'validee' ? direction : null,
      valideLe: statut === 'validee' ? jour(ctx, -3) : null,
      motifRejet: statut === 'rejetee' ? 'Prix unitaire différent du bon de commande' : null,
    });
    for (const [n, l] of cmd.lignes.entries()) {
      const art = articles.find((a) => a.id === l.articleId);
      await ins(ctx, 'facture_fournisseur_ligne', {
        factureFournisseurId: ffId,
        numeroOrdre: n + 1,
        referenceArticle: art?.reference ?? null,
        designation: art?.designation ?? 'Article',
        quantiteMillieme: l.qte,
        prixUnitaireCentimes: l.prix,
        totalLigneCentimes: Math.round((l.qte / 1000) * l.prix),
        origine: 'texte_pdf',
        articleId: l.articleId,
        commandeFournisseurLigneId: l.id,
        ecartPrixUnitaireCentimes: statut === 'rejetee' && n === 0 ? 150 : 0,
        ecartQuantiteMillieme: 0,
        ecartTotalCentimes: 0,
      });
    }
  }

  // Mouvements divers + transfert entre sites + stock bas
  const [a1, a2, a3, a4] = [articles[2], articles[10], articles[18], articles[12]];
  if (a1) {
    await ins(ctx, 'mouvement_stock', {
      articleId: a1.id,
      type: 'transfert',
      quantiteMillieme: 5000,
      siteSourceId: siteSion,
      siteDestinationId: siteMartigny,
      auteurId: magasinier,
      motif: 'Réapprovisionnement Martigny',
      creeLe: jour(ctx, -9, 15),
    });
  }
  if (a2) {
    await ins(ctx, 'mouvement_stock', {
      articleId: a2.id,
      type: 'casse',
      quantiteMillieme: -1000,
      siteId: siteSion,
      auteurId: magasinier,
      motif: 'Bidon percé lors du rangement',
      creeLe: jour(ctx, -5, 16),
    });
  }
  if (a3) {
    await ins(ctx, 'mouvement_stock', {
      articleId: a3.id,
      type: 'ajustement_inventaire',
      quantiteMillieme: -2000,
      siteId: siteMartigny,
      auteurId: magasinier,
      motif: 'Inventaire annuel : écart constaté',
      creeLe: jour(ctx, -14, 17),
    });
  }
  if (a4) {
    await ins(ctx, 'mouvement_stock', {
      articleId: a4.id,
      type: 'retour_client',
      quantiteMillieme: 1000,
      siteId: siteMartigny,
      auteurId: magasinier,
      motif: 'Retour d’une pièce non utilisée',
      creeLe: jour(ctx, -4, 10),
    });
  }
  // Stock bas : le minimum dépasse le stock sur plusieurs articles ; rupture totale sur deux.
  await ctx.c.query(
    `update stock_article set stock_minimum_millieme = quantite_physique_millieme + 4000
      where tenant_id = $1 and (article_id, site_id) in (
        select article_id, site_id from stock_article where tenant_id = $1 order by md5(article_id::text || site_id::text) limit 9)`,
    [ctx.tenantId],
  );
  const rupture = await sql<{ article_id: string; site_id: string; q: number; r: number }>(
    ctx,
    `select article_id, site_id, quantite_physique_millieme q, quantite_reservee_millieme r from stock_article where tenant_id = $1 and quantite_reservee_millieme = 0 order by md5(article_id::text || 'x') limit 2`,
    [ctx.tenantId],
  );
  for (const r of rupture) {
    await ins(ctx, 'mouvement_stock', {
      articleId: r.article_id,
      type: 'perte',
      quantiteMillieme: -r.q,
      siteId: r.site_id,
      auteurId: magasinier,
      motif: 'Dernières pièces introuvables après déménagement du rayon',
      creeLe: jour(ctx, -3, 16),
    });
  }
  void tvaDe;
  void choisir;
  ctx.journaliser(
    `  ${String(specs.length)} commandes fournisseur, ${String(statutsFF.length)} factures fournisseur, transferts/casse/inventaire, stock bas`,
  );
}

/** Consignes d'échange standard (alternateur, démarreur) : pièce usagée déposée, en attente de retour, retournée. */
export async function semerConsignes(ctx: Ctx, pieces: ResultatPieces): Promise<void> {
  const magasinier = ctx.utilisateurs.get('magasinier') ?? null;
  const echanges = pieces.articles.filter((a) => a.reference.endsWith('-ECH'));
  const ors = await sql<{ id: string; site_id: string }>(
    ctx,
    `select id, site_id from ordre_reparation where tenant_id = $1 and statut in ('ouvert','en_cours') order by ouvert_le desc limit 3`,
    [ctx.tenantId],
  );
  const statuts = ['deposee_par_client', 'en_attente_retour_fournisseur', 'retournee_fournisseur'];
  for (const [i, o] of ors.entries()) {
    const art = echanges[i % Math.max(1, echanges.length)];
    if (!art) continue;
    const max = await sql<{ n: number }>(
      ctx,
      `select coalesce(max(numero_ordre), 0) n from ligne_or where tenant_id = $1 and ordre_reparation_id = $2`,
      [ctx.tenantId, o.id],
    );
    const ht = art.prixCentimes;
    const tva = tvaDe(ht);
    const ligneId = await ins(ctx, 'ligne_or', {
      ordreReparationId: o.id,
      numeroOrdre: (max[0]?.n ?? 0) + 1,
      type: 'piece',
      origine: 'commandee',
      statut: 'validee',
      payeur: 'client',
      designation: art.designation,
      articleId: art.id,
      quantiteMillieme: 1000,
      prixUnitaireCentimes: ht,
      tauxTvaPourmille: 81,
      montantHtCentimes: ht,
      montantTvaCentimes: tva,
      montantTtcCentimes: ht + tva,
    });
    const entree = await ins(ctx, 'mouvement_stock', {
      articleId: art.id,
      type: 'retour_consigne',
      quantiteMillieme: 1000,
      siteId: o.site_id,
      ligneOrId: ligneId,
      auteurId: magasinier,
      motif: 'Pièce usagée déposée par le client',
      creeLe: jour(ctx, -(i + 1), 11),
    });
    const statut = statuts[i] ?? 'deposee_par_client';
    let retour: string | null = null;
    if (statut === 'retournee_fournisseur') {
      retour = await ins(ctx, 'mouvement_stock', {
        articleId: art.id,
        type: 'retour_fournisseur',
        quantiteMillieme: -1000,
        siteId: o.site_id,
        auteurId: magasinier,
        motif: 'Retour de la pièce usagée au fournisseur (consigne)',
        creeLe: jour(ctx, -1, 15),
      });
    }
    await ins(ctx, 'consigne_echange_standard', {
      ligneOrId: ligneId,
      ordreReparationId: o.id,
      articleId: art.id,
      siteId: o.site_id,
      statut,
      montantConsigneTtcCentimes: 8000,
      mouvementEntreeId: entree,
      retourneeFournisseurLe: retour ? jour(ctx, -1, 15) : null,
      mouvementRetourId: retour,
    });
  }
  ctx.journaliser(`  ${String(ors.length)} consignes d’échange standard`);
}
