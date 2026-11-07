/**
 * Jeu de démonstration « complet » — atelier et facturation.
 *
 * Crée une cinquantaine d'ordres de réparation couvrant TOUS les statuts de la machine à états
 * (planifié, ouvert, en cours, contrôle, terminé, facturé, restitué, clôturé, annulé), avec lignes
 * de main-d'œuvre / pièces / forfaits, travaux constatés en attente d'accord, lignes refusées,
 * devis atelier (brouillon, envoyé, accepté, refusé, expiré, devis → OR), factures émises, payées,
 * partiellement payées et en retard, avoirs, et paiements (virement, carte, espèces, QR, TWINT).
 *
 * Chaque OR traverse ses états UN PAR UN (les triggers de la base refusent tout saut), et ses
 * lignes sont posées pendant qu'il est encore modifiable.
 */
import {
  choisir,
  entre,
  ins,
  jour,
  jourOuvre,
  ajouterJours,
  maj,
  prochainNumero,
  sql,
  tvaDe,
  type Ctx,
} from './seed-complement-outils';
import {
  annulerParAvoir,
  changerStatutDocument,
  creerDocument,
  encaisser,
  type DocumentCree,
  type LigneDocSpec,
} from './seed-complement-documents';
import type { ClientDemo, VehiculeDemo } from './seed-complement-personnes';

export interface ArticleDemo {
  readonly id: string;
  readonly reference: string;
  readonly designation: string;
  readonly categorie: string;
  /** Prix de vente utilisé comme HT par les lignes d'OR (convention du seed existant). */
  readonly prixCentimes: number;
}

type TypeLigne = 'main_oeuvre_bareme' | 'forfait' | 'piece' | 'sous_traitance' | 'fourniture';
interface ModeleLigne {
  readonly type: TypeLigne;
  readonly designation: string;
  readonly ht?: number;
  readonly temps?: number;
  readonly cat?: string;
  readonly quantiteMilli?: number;
}
const GABARITS: Record<string, { type: string; verbatim: string; lignes: ModeleLigne[] }> = {
  SERVICE: {
    type: 'service',
    verbatim: 'Service des 30 000 km, vidange et contrôle général.',
    lignes: [
      { type: 'main_oeuvre_bareme', designation: 'Service d’entretien — main-d’œuvre', temps: 120 },
      { type: 'piece', designation: '', cat: 'lubrifiant' },
      { type: 'piece', designation: '', cat: 'piece_mecanique' },
    ],
  },
  FREINS: {
    type: 'reparation',
    verbatim: 'Bruit de frottement au freinage, pédale spongieuse.',
    lignes: [
      {
        type: 'main_oeuvre_bareme',
        designation: 'Remplacement plaquettes et disques avant',
        temps: 150,
      },
      { type: 'piece', designation: '', cat: 'piece_mecanique' },
      { type: 'forfait', designation: 'Purge du liquide de frein', ht: 6500 },
    ],
  },
  PNEUS: {
    type: 'pneus',
    verbatim: 'Passage aux pneus d’hiver, contrôle de la pression.',
    lignes: [
      { type: 'forfait', designation: 'Montage et équilibrage 4 roues', ht: 8000 },
      { type: 'piece', designation: '', cat: 'pneu', quantiteMilli: 4000 },
    ],
  },
  MFK: {
    type: 'expertise',
    verbatim: 'Préparation et présentation à l’expertise MFK.',
    lignes: [
      { type: 'forfait', designation: 'Préparation à l’expertise MFK', ht: 15000 },
      { type: 'forfait', designation: 'Présentation au service des automobiles', ht: 5500 },
    ],
  },
  DIAG: {
    type: 'diagnostic',
    verbatim: 'Voyant moteur allumé, perte de puissance à l’accélération.',
    lignes: [
      { type: 'forfait', designation: 'Diagnostic électronique OBD', ht: 12000 },
      { type: 'main_oeuvre_bareme', designation: 'Recherche de panne (temps passé)', temps: 60 },
    ],
  },
  CLIM: {
    type: 'service',
    verbatim: 'La climatisation ne refroidit plus.',
    lignes: [
      { type: 'forfait', designation: 'Recharge et contrôle de la climatisation', ht: 14000 },
      { type: 'piece', designation: '', cat: 'fourniture' },
    ],
  },
  BATTERIE: {
    type: 'reparation',
    verbatim: 'Démarrage difficile le matin.',
    lignes: [
      { type: 'main_oeuvre_bareme', designation: 'Remplacement de la batterie', temps: 30 },
      { type: 'piece', designation: '', cat: 'piece_mecanique' },
    ],
  },
  EMBRAYAGE: {
    type: 'reparation',
    verbatim: 'L’embrayage patine en côte.',
    lignes: [
      { type: 'main_oeuvre_bareme', designation: 'Remplacement du kit d’embrayage', temps: 400 },
      { type: 'piece', designation: '', cat: 'piece_mecanique' },
      { type: 'fourniture', designation: 'Fournitures et joints', ht: 2500 },
    ],
  },
  DISTRIBUTION: {
    type: 'reparation',
    verbatim: 'Remplacement préventif de la distribution (120 000 km).',
    lignes: [
      {
        type: 'main_oeuvre_bareme',
        designation: 'Remplacement distribution et pompe à eau',
        temps: 480,
      },
      { type: 'piece', designation: '', cat: 'piece_mecanique' },
    ],
  },
  CARROSSERIE: {
    type: 'carrosserie',
    verbatim: 'Pare-chocs arrière enfoncé après un petit accrochage.',
    lignes: [
      { type: 'forfait', designation: 'Réparation du pare-chocs arrière', ht: 95000 },
      { type: 'sous_traitance', designation: 'Peinture (carrosserie partenaire)', ht: 48000 },
    ],
  },
};
const CLES_GABARITS = Object.keys(GABARITS);
const CONSTATS: Array<{ designation: string; ht: number; securite: boolean; urgence: string }> = [
  {
    designation: 'Constat : plaquettes arrière usées à 80 %',
    ht: 31000,
    securite: true,
    urgence: 'urgent',
  },
  {
    designation: 'Constat : amortisseur avant gauche fuyard',
    ht: 42000,
    securite: true,
    urgence: 'a_faire',
  },
  {
    designation: 'Constat : essuie-glaces à remplacer',
    ht: 4500,
    securite: false,
    urgence: 'a_faire',
  },
  {
    designation: 'Constat : courroie d’accessoires craquelée',
    ht: 18500,
    securite: false,
    urgence: 'a_surveiller',
  },
];

interface SpecOr {
  statut: string;
  jours: number;
  site: 'SION' | 'MARTIGNY';
  paiement?: 'regle' | 'partiel' | 'impaye' | 'retard' | 'retard_grave';
  moyen?: string;
  devis?: boolean;
  constat?: 'attente' | 'refuse';
  courtoisie?: boolean;
}

function specsOr(): SpecOr[] {
  const moyens = ['virement', 'carte', 'especes', 'qr', 'twint', 'virement', 'carte'];
  const l: SpecOr[] = [];
  for (let i = 0; i < 20; i++) {
    l.push({
      statut: 'cloture',
      jours: 240 - i * 11,
      site: i % 3 === 0 ? 'MARTIGNY' : 'SION',
      paiement: i === 6 ? 'partiel' : 'regle',
      moyen: moyens[i % moyens.length],
      devis: i === 9,
      constat: i === 4 ? 'refuse' : undefined,
    });
  }
  l.push({ statut: 'restitue', jours: 96, site: 'SION', paiement: 'retard_grave' });
  l.push({ statut: 'restitue', jours: 74, site: 'MARTIGNY', paiement: 'retard' });
  l.push({ statut: 'restitue', jours: 61, site: 'SION', paiement: 'retard' });
  l.push({
    statut: 'restitue',
    jours: 47,
    site: 'MARTIGNY',
    paiement: 'partiel',
    moyen: 'virement',
  });
  l.push({ statut: 'facture', jours: 14, site: 'SION', paiement: 'impaye' });
  l.push({ statut: 'facture', jours: 9, site: 'MARTIGNY', paiement: 'partiel', moyen: 'carte' });
  l.push({ statut: 'facture', jours: 6, site: 'SION', paiement: 'impaye' });
  l.push(
    { statut: 'termine', jours: 4, site: 'SION' },
    { statut: 'termine', jours: 3, site: 'MARTIGNY' },
    { statut: 'termine', jours: 2, site: 'SION' },
    { statut: 'termine', jours: 1, site: 'MARTIGNY', courtoisie: true },
  );
  l.push(
    { statut: 'controle', jours: 2, site: 'SION' },
    { statut: 'controle', jours: 1, site: 'MARTIGNY' },
  );
  l.push(
    { statut: 'en_cours', jours: 3, site: 'SION', devis: true },
    { statut: 'en_cours', jours: 2, site: 'MARTIGNY', courtoisie: true },
    { statut: 'en_cours', jours: 2, site: 'SION' },
    { statut: 'en_cours', jours: 1, site: 'SION', constat: 'attente' },
    { statut: 'en_cours', jours: 1, site: 'MARTIGNY' },
    { statut: 'en_cours', jours: 0, site: 'SION' },
  );
  l.push(
    { statut: 'ouvert', jours: 1, site: 'SION', constat: 'attente' },
    { statut: 'ouvert', jours: 1, site: 'MARTIGNY' },
    { statut: 'ouvert', jours: 0, site: 'SION' },
    { statut: 'ouvert', jours: 0, site: 'MARTIGNY' },
    { statut: 'ouvert', jours: 0, site: 'SION', constat: 'attente' },
  );
  l.push(
    { statut: 'planifie', jours: -1, site: 'SION' },
    { statut: 'planifie', jours: -3, site: 'MARTIGNY' },
    { statut: 'planifie', jours: -6, site: 'SION' },
  );
  l.push(
    { statut: 'annule', jours: 40, site: 'SION' },
    { statut: 'annule', jours: 8, site: 'MARTIGNY' },
  );
  return l.sort((a, b) => b.jours - a.jours);
}

export interface ResultatAtelier {
  readonly facturesImpayees: Array<{ doc: DocumentCree; client: ClientDemo; niveau: number }>;
  readonly orsActifs: Array<{
    id: string;
    clientId: string;
    vehiculeId: string;
    siteCode: string;
    statut: string;
    numero: string;
  }>;
  readonly orsPlanifies: Array<{
    id: string;
    clientId: string;
    vehiculeId: string;
    siteCode: string;
    date: Date;
  }>;
  readonly lignesOrParTech: Map<
    string,
    Array<{
      ligneId: string;
      orId: string;
      duree: number;
      jour: Date;
      statut: string;
      siteCode: string;
    }>
  >;
  readonly devisSansReponse: Array<{ doc: DocumentCree; client: ClientDemo }>;
  readonly facturesPayees: DocumentCree[];
  readonly lignesPieces: Array<{
    ligneId: string;
    orId: string;
    articleId: string;
    quantiteMilli: number;
    siteCode: string;
    statutOr: string;
    statutLigne: string;
    date: Date;
  }>;
  readonly orsPourRdv: Array<{ id: string; clientId: string; vehiculeId: string }>;
}

function locDe(statut: string): string {
  if (statut === 'termine') return 'pret_au_retrait';
  if (['facture', 'restitue', 'cloture'].includes(statut)) return 'restitue';
  return 'parc';
}

const TECHS = ['technicien', 'technicien-rey', 'technicien-fournier', 'technicien-bonvin'];

export async function semerAtelierEtFacturation(
  ctx: Ctx,
  clients: ClientDemo[],
  vehicules: VehiculeDemo[],
  articles: ArticleDemo[],
): Promise<ResultatAtelier> {
  const res: ResultatAtelier = {
    facturesImpayees: [],
    orsActifs: [],
    orsPlanifies: [],
    lignesOrParTech: new Map(),
    devisSansReponse: [],
    facturesPayees: [],
    lignesPieces: [],
    orsPourRdv: [],
  };
  const clientParId = new Map(clients.map((c) => [c.id, c]));
  const specs = specsOr();
  const nbActifs = specs.filter(
    (s) => !['cloture', 'restitue', 'facture', 'annule'].includes(s.statut),
  ).length;
  const reception = ctx.utilisateurs.get('receptionnaire') ?? null;
  const comptable = ctx.utilisateurs.get('comptable') ?? null;
  const siteId = (code: string): string => {
    const id = ctx.sites.get(code);
    if (!id) throw new Error(`site ${code}`);
    return id;
  };
  let idxActif = 0;
  let idxFacture = nbActifs + 3;
  let compteGabarit = 0;
  let compteDevis = 0;
  const avoirsAFaire: Array<{
    doc: DocumentCree;
    client: ClientDemo;
    siteId: string;
    orLignes: LigneDocSpec[];
    cible: 'total' | 'partiel';
  }> = [];

  for (const [i, spec] of specs.entries()) {
    const actif = !['cloture', 'restitue', 'facture', 'annule'].includes(spec.statut);
    const vehicule = actif
      ? vehicules[idxActif++ % vehicules.length]
      : vehicules[idxFacture++ % vehicules.length];
    if (!vehicule) throw new Error('aucun véhicule');
    const client = clientParId.get(vehicule.clientId);
    if (!client) throw new Error('client du véhicule introuvable');
    const gabaritCle = CLES_GABARITS[compteGabarit++ % CLES_GABARITS.length] ?? 'SERVICE';
    const gabarit = GABARITS[gabaritCle];
    if (!gabarit) throw new Error('gabarit');

    const ouvertJour = jourOuvre(jour(ctx, -spec.jours, 6, 45 + (i % 4) * 10));
    const ouvert = spec.statut === 'planifie' ? null : ouvertJour;
    const annee = ouvertJour.getUTCFullYear();
    const num = await prochainNumero(ctx, 'ordre_reparation', annee);
    const numero = `OR-${String(annee)}-${String(num)}`;
    const technicien = ctx.utilisateurs.get(TECHS[i % TECHS.length] ?? 'technicien') ?? null;
    const siteCode = spec.site;
    const promesse =
      spec.statut === 'planifie'
        ? jour(ctx, -spec.jours, 15)
        : ['ouvert', 'en_cours', 'controle', 'termine'].includes(spec.statut)
          ? jour(ctx, entre(ctx, 0, 3), 16, 30)
          : null;

    const orId = await ins(ctx, 'ordre_reparation', {
      numero,
      siteId: siteId(siteCode),
      type: gabarit.type,
      statut: spec.statut === 'planifie' ? 'planifie' : 'ouvert',
      clientId: client.id,
      vehiculeId: vehicule.id,
      clientDesignationFigee: client.designation,
      adresseFacturationFigee: {
        npa: client.adresse.npa,
        rue: client.adresse.rue,
        pays: 'CH',
        type: 'principale',
        localite: client.adresse.localite,
        complement: null,
      },
      conditionsFigees: {},
      plaqueFigee: vehicule.plaque,
      detenteurFigeClientId: client.id,
      kmEntree: ouvert ? Math.max(0, vehicule.km - entre(ctx, 50, 900)) : null,
      localisation: locDe(spec.statut),
      receptionnaireId: reception,
      ouvertLe: ouvert,
      restitutionPromiseLe: promesse,
      restitutionInitialeLe: promesse,
      plafondCentimes: i % 7 === 0 && actif ? 150000 : null,
      plafondAutorisePar: i % 7 === 0 && actif ? 'M. ' + client.designation.split(' ').pop() : null,
      origine: 'dfa',
      creeLe: ouvert ?? jour(ctx, -2, 9),
    });
    await ins(ctx, 'ordre_reparation_demande', {
      ordreReparationId: orId,
      ordre: 1,
      verbatim: gabarit.verbatim,
      saisiParId: reception,
    });
    if (i % 3 === 0) {
      await ins(ctx, 'ordre_reparation_demande', {
        ordreReparationId: orId,
        ordre: 2,
        verbatim: choisir(ctx, [
          'Merci de vérifier aussi le niveau de liquide lave-glace.',
          'Le client demande un devis pour les pneus été.',
          'Bruit métallique signalé à froid.',
        ]),
        saisiParId: reception,
      });
    }

    // --- Devis atelier à l'origine de l'OR ---------------------------------------------------
    if (spec.devis) {
      const lignesDevis: LigneDocSpec[] = gabarit.lignes.map((m) => ({
        type: m.type,
        designation: m.designation || 'Pièces',
        quantiteMilli: 1000,
        ttcCentimes: (m.ht ?? 20000) + tvaDe(m.ht ?? 20000),
      }));
      const devis = await creerDocument(ctx, {
        type: 'devis',
        siteId: siteId(siteCode),
        client,
        vehiculeId: vehicule.id,
        date: ajouterJours(ouvertJour, -4),
        lignes: lignesDevis,
        emettre: true,
      });
      await changerStatutDocument(ctx, devis.id, 'accepte');
      await maj(ctx, 'ordre_reparation', orId, { devisOrigineId: devis.id });
      compteDevis++;
    }

    // --- Lignes -----------------------------------------------------------------------------
    const modeles: ModeleLigne[] = [...gabarit.lignes];
    if (spec.constat) modeles.push({ type: 'piece', designation: '', cat: '__constat' });
    const lignesCreees: Array<{
      id: string;
      ht: number;
      tva: number;
      type: string;
      designation: string;
      q: number;
      pieceArticleId?: string;
    }> = [];
    let numLigne = 0;
    const statutOrFinal = spec.statut;
    for (const m of modeles) {
      numLigne++;
      let ht = m.ht ?? 0;
      let designation = m.designation;
      let articleId: string | null = null;
      let q = m.quantiteMilli ?? 1000;
      let tauxHoraire: number | null = null;
      const temps: number | null = m.temps ?? null;
      let origine = 'commandee';
      let urgence: string | null = null;
      let securite = false;
      if (m.cat === '__constat') {
        const c = CONSTATS[i % CONSTATS.length];
        if (!c) continue;
        ht = c.ht;
        designation = c.designation;
        origine = 'constatee';
        urgence = c.urgence;
        securite = c.securite;
        q = 1000;
      } else if (m.type === 'main_oeuvre_bareme') {
        tauxHoraire = 14500;
        ht = Math.round(((m.temps ?? 0) * 14500) / 100);
      } else if (m.cat) {
        const candidats = articles.filter((a) => a.categorie === m.cat);
        const art = candidats.length > 0 ? choisir(ctx, candidats) : choisir(ctx, articles);
        articleId = art.id;
        designation = art.designation;
        ht = art.prixCentimes * Math.round(q / 1000);
      } else {
        q = 1000;
      }
      const tva = tvaDe(ht);

      let statutLigne: string;
      const constatLigne = m.cat === '__constat';
      if (constatLigne) statutLigne = spec.constat === 'refuse' ? 'refusee' : 'a_valider';
      else if (['cloture', 'restitue', 'facture', 'termine', 'controle'].includes(statutOrFinal))
        statutLigne = 'realisee';
      else if (statutOrFinal === 'en_cours')
        statutLigne = numLigne === 1 ? 'realisee' : numLigne === 2 ? 'en_cours' : 'validee';
      else if (statutOrFinal === 'annule') statutLigne = 'annulee';
      else statutLigne = 'validee';

      const ligneId = await ins(ctx, 'ligne_or', {
        ordreReparationId: orId,
        numeroOrdre: numLigne,
        type: m.type,
        origine,
        statut: statutLigne,
        payeur: 'client',
        designation,
        articleId,
        quantiteMillieme: q,
        tempsBaremeCentiemes: temps,
        tauxHoraireCentimes: tauxHoraire,
        prixUnitaireCentimes: tauxHoraire ? null : Math.round(ht / (q / 1000)),
        tauxTvaPourmille: 81,
        montantHtCentimes: ht,
        montantTvaCentimes: tva,
        montantTtcCentimes: ht + tva,
        technicienId:
          m.type === 'main_oeuvre_bareme' ||
          statutLigne === 'realisee' ||
          statutLigne === 'en_cours'
            ? technicien
            : null,
        urgence,
        securite,
        motifAnnulation: statutLigne === 'annulee' ? 'Annulation de l’OR par le client' : null,
        creeLe: ouvert ?? undefined,
      });
      if (statutLigne === 'realisee' || statutLigne === 'en_cours') {
        const duree = temps
          ? Math.round(temps * 36 * (0.85 + ctx.rnd() * 0.3))
          : entre(ctx, 1500, 4800);
        const clef = technicien ?? 'inconnu';
        const arr = res.lignesOrParTech.get(clef) ?? [];
        arr.push({ ligneId, orId, duree, jour: ouvertJour, statut: statutLigne, siteCode });
        res.lignesOrParTech.set(clef, arr);
      }
      if (articleId && statutLigne !== 'annulee' && statutLigne !== 'refusee') {
        res.lignesPieces.push({
          ligneId,
          orId,
          articleId,
          quantiteMilli: q,
          siteCode,
          statutOr: statutOrFinal,
          statutLigne,
          date: ouvertJour,
        });
      }
      if (statutLigne !== 'refusee' && statutLigne !== 'annulee')
        lignesCreees.push({ id: ligneId, ht, tva, type: m.type, designation, q });
    }

    // --- Facturation (avant de verrouiller l'OR) --------------------------------------------
    let facture: DocumentCree | null = null;
    const facturable = ['cloture', 'restitue', 'facture'].includes(statutOrFinal);
    if (facturable) {
      const dateFacture = ajouterJours(ouvertJour, 3 + (i % 3));
      const lignesDoc: LigneDocSpec[] = lignesCreees.map((l) => ({
        type: l.type,
        designation: l.designation,
        quantiteMilli: l.q,
        ttcCentimes: l.ht + l.tva,
        ligneOrId: l.id,
      }));
      facture = await creerDocument(ctx, {
        type: 'facture',
        siteId: siteId(siteCode),
        client,
        vehiculeId: vehicule.id,
        orId,
        date: dateFacture,
        lignes: lignesDoc,
        emettre: true,
        delaiJours: 30,
      });
      for (const l of lignesCreees)
        await maj(ctx, 'ligne_or', l.id, { statut: 'facturee', factureId: facture.id });

      // Règlements
      const suivi = { regle: 0, total: facture.totalTtc };
      const base = { siteId: siteId(siteCode), client, auteurId: comptable };
      const echeance = ajouterJours(dateFacture, 30);
      switch (spec.paiement) {
        case 'regle': {
          const date = ajouterJours(dateFacture, entre(ctx, 0, 21));
          await encaisser(ctx, facture, suivi, {
            ...base,
            date: date > ctx.maintenant ? ctx.maintenant : date,
            moyen: spec.moyen ?? 'virement',
            montant: facture.totalTtc,
          });
          res.facturesPayees.push(facture);
          break;
        }
        case 'partiel': {
          const part = Math.round((facture.totalTtc * 0.4) / 5) * 5;
          await encaisser(ctx, facture, suivi, {
            ...base,
            date: ajouterJours(dateFacture, 8),
            moyen: spec.moyen ?? 'virement',
            montant: part,
          });
          const enRetard = echeance < ctx.maintenant;
          if (enRetard) res.facturesImpayees.push({ doc: facture, client, niveau: 1 });
          break;
        }
        case 'retard':
        case 'retard_grave':
          res.facturesImpayees.push({
            doc: facture,
            client,
            niveau: spec.paiement === 'retard_grave' ? 3 : 2,
          });
          break;
        default:
          break;
      }
      if (['cloture'].includes(statutOrFinal) && i % 6 === 2) {
        avoirsAFaire.push({
          doc: facture,
          client,
          siteId: siteId(siteCode),
          orLignes: lignesDoc,
          cible: i % 12 === 2 ? 'total' : 'partiel',
        });
      }
    }

    // --- Progression de l'OR, un état à la fois ---------------------------------------------
    const parcours: Array<[string, Record<string, unknown>]> = [];
    const t = (n: number): Date => new Date(ouvertJour.getTime() + n * 3600_000);
    const ordre = ['en_cours', 'controle', 'termine', 'facture', 'restitue', 'cloture'];
    if (spec.statut === 'annule') {
      parcours.push([
        'annule',
        {
          annuleLe: jour(ctx, -spec.jours + 1, 10),
          motifAnnulation: 'Le client a renoncé aux travaux (devis jugé trop élevé)',
        },
      ]);
    } else if (spec.statut !== 'planifie' && spec.statut !== 'ouvert') {
      const cible = ordre.indexOf(spec.statut);
      for (let k = 0; k <= cible; k++) {
        const etat = ordre[k] ?? 'en_cours';
        if (etat === 'controle' && !['controle'].includes(spec.statut)) continue; // saut direct en_cours -> termine
        const extra: Record<string, unknown> = {};
        if (etat === 'termine') extra['termineLe'] = t(6 + (i % 3));
        if (etat === 'facture') extra['factureLe'] = facture?.dateDocument ?? t(30);
        if (etat === 'restitue') {
          extra['restitueLe'] = t(80);
          extra['kmSortie'] = vehicule.km + entre(ctx, 5, 30);
        }
        if (etat === 'cloture') extra['clotureLe'] = t(100);
        parcours.push([etat, extra]);
      }
    }
    for (const [etat, extra] of parcours)
      await maj(ctx, 'ordre_reparation', orId, {
        statut: etat,
        ...extra,
        localisation: locDe(etat),
      });

    if (actif && spec.statut !== 'planifie')
      res.orsActifs.push({
        id: orId,
        clientId: client.id,
        vehiculeId: vehicule.id,
        siteCode,
        statut: spec.statut,
        numero,
      });
    if (spec.statut === 'planifie')
      res.orsPlanifies.push({
        id: orId,
        clientId: client.id,
        vehiculeId: vehicule.id,
        siteCode,
        date: jour(ctx, -spec.jours, 8),
      });
    if (actif) res.orsPourRdv.push({ id: orId, clientId: client.id, vehiculeId: vehicule.id });
  }

  // --- Avoirs -----------------------------------------------------------------------------------
  let nAvoirs = 0;
  for (const a of avoirsAFaire) {
    const total = a.cible === 'total';
    const lignes = total ? a.orLignes : a.orLignes.slice(0, 1);
    const avoir = await creerDocument(ctx, {
      type: 'avoir',
      siteId: a.siteId,
      client: a.client,
      orId: null,
      date: ajouterJours(a.doc.dateDocument, 12),
      lignes: lignes.map((l) => ({ ...l, ligneOrId: undefined })),
      emettre: true,
      factureAnnulee: {
        id: a.doc.id,
        portee: total ? 'total' : 'partiel',
        motif: total
          ? 'prestation_annulee'
          : nAvoirs % 2 === 0
            ? 'geste_commercial'
            : 'erreur_montant',
      },
    });
    if (total) await annulerParAvoir(ctx, a.doc.id, avoir.id);
    nAvoirs++;
  }
  ctx.journaliser(
    `  ${String(specs.length)} OR (tous statuts), ${String(compteDevis)} devis→OR, ${String(nAvoirs)} avoirs, factures émises/payées/en retard`,
  );

  // --- Devis atelier hors OR -----------------------------------------------------------------
  const libre = vehicules.slice(40, 60);
  const devisSpecs: Array<{
    statut: 'brouillon' | 'emis' | 'accepte' | 'refuse' | 'expire';
    jours: number;
    gab: string;
  }> = [
    { statut: 'brouillon', jours: 0, gab: 'EMBRAYAGE' },
    { statut: 'brouillon', jours: 1, gab: 'CARROSSERIE' },
    { statut: 'emis', jours: 2, gab: 'DISTRIBUTION' },
    { statut: 'emis', jours: 12, gab: 'FREINS' },
    { statut: 'emis', jours: 20, gab: 'CLIM' },
    { statut: 'accepte', jours: 6, gab: 'BATTERIE' },
    { statut: 'accepte', jours: 18, gab: 'PNEUS' },
    { statut: 'refuse', jours: 30, gab: 'DISTRIBUTION' },
    { statut: 'expire', jours: 75, gab: 'CARROSSERIE' },
  ];
  for (const [k, d] of devisSpecs.entries()) {
    const v = libre[k % libre.length];
    const gab = GABARITS[d.gab];
    const client = v ? clientParId.get(v.clientId) : undefined;
    if (!v || !gab || !client) continue;
    const lignes: LigneDocSpec[] = gab.lignes.map((m) => {
      const ht =
        m.type === 'main_oeuvre_bareme'
          ? Math.round(((m.temps ?? 0) * 14500) / 100)
          : (m.ht ?? 24000);
      return {
        type: m.type,
        designation: m.designation || 'Pièces d’origine',
        quantiteMilli: 1000,
        ttcCentimes: ht + tvaDe(ht),
      };
    });
    const doc = await creerDocument(ctx, {
      type: 'devis',
      siteId: siteId(k % 2 === 0 ? 'SION' : 'MARTIGNY'),
      client,
      vehiculeId: v.id,
      date: jourOuvre(jour(ctx, -d.jours, 9)),
      lignes,
      emettre: d.statut !== 'brouillon',
    });
    if (d.statut === 'accepte' || d.statut === 'refuse' || d.statut === 'expire')
      await changerStatutDocument(ctx, doc.id, d.statut);
    if (d.statut === 'emis') res.devisSansReponse.push({ doc, client });
  }

  // --- Ventes comptoir (factures sans OR) pour les chiffres des derniers mois ----------------------
  const comptoir: Array<[string, number]> = [
    ['Vente comptoir — balais d’essuie-glace', 3600],
    ['Vente comptoir — bidon d’huile moteur 5W30 5 L', 5900],
    ['Vente comptoir — jeu d’ampoules H7', 2800],
    ['Vente comptoir — liquide de refroidissement 5 L', 3400],
    ['Vente comptoir — batterie 12 V 60 Ah', 14900],
    ['Vente comptoir — tapis de coffre', 8900],
    ['Vente comptoir — chaînes à neige', 12900],
    ['Vente comptoir — kit de premiers secours + triangle', 3900],
  ];
  const moyensComptoir = [
    'carte',
    'especes',
    'twint',
    'carte',
    'especes',
    'virement',
    'carte',
    'twint',
  ];
  for (const [k, [designation, ht]] of comptoir.entries()) {
    const client = clients[(k * 5 + 3) % clients.length];
    if (!client) continue;
    const date = jourOuvre(jour(ctx, -(10 + k * 27), 11));
    const ttc = ht + tvaDe(ht);
    const doc = await creerDocument(ctx, {
      type: 'facture',
      siteId: siteId(k % 2 === 0 ? 'SION' : 'MARTIGNY'),
      client,
      date,
      delaiJours: 0,
      lignes: [{ type: 'fourniture', designation, quantiteMilli: 1000, ttcCentimes: ttc }],
      emettre: true,
    });
    await encaisser(
      ctx,
      doc,
      { regle: 0, total: doc.totalTtc },
      {
        siteId: siteId(k % 2 === 0 ? 'SION' : 'MARTIGNY'),
        client,
        date,
        moyen: moyensComptoir[k] ?? 'carte',
        montant: doc.totalTtc,
        auteurId: comptable,
      },
    );
    res.facturesPayees.push(doc);
  }

  // --- Relances sur factures échues (niveau + journal) ------------------------------------------
  for (const f of res.facturesImpayees) {
    await maj(ctx, 'document_vente', f.doc.id, {
      relanceNiveau: f.niveau === 3 ? 2 : f.niveau,
      relanceLe: jour(ctx, -entre(ctx, 3, 12), 9),
      contentieux: f.niveau === 3,
    });
  }
  // Les OR facturés non encore échus ne sont pas en retard : rien à faire.
  void sql;
  return res;
}
