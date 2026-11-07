/**
 * Jeu de démonstration « complet » — planning, pointage, voitures de courtoisie, contrôle qualité,
 * devis complémentaires, hôtel à pneus, ventes VN/VO, relances, export fiduciaire et périodes.
 */
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  ajouterJours,
  choisir,
  entre,
  ins,
  iso,
  jour,
  jourOuvre,
  maj,
  sql,
  tvaDe,
  type Ctx,
} from './seed-complement-outils';
import { creerDocument, encaisser } from './seed-complement-documents';
import type { ResultatAtelier } from './seed-complement-atelier';
import type { ClientDemo, VehiculeDemo } from './seed-complement-personnes';

const heure = (h: number, m: number): string =>
  `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

// ---------------------------------------------------------------------------------------------
// Rendez-vous
// ---------------------------------------------------------------------------------------------

export async function semerRendezVous(
  ctx: Ctx,
  clients: ClientDemo[],
  vehicules: VehiculeDemo[],
  res: ResultatAtelier,
): Promise<void> {
  const motifs = await sql<{ id: string; code: string; duree_defaut_minutes: number }>(
    ctx,
    `select id, code, duree_defaut_minutes from motif_rendez_vous where tenant_id = $1 and actif`,
    [ctx.tenantId],
  );
  const typeParMotif: Record<string, string> = {
    SERVICE: 'service',
    PNEUS: 'pneus',
    'EXPERTISE-MFK': 'expertise',
    DIAGNOSTIC: 'diagnostic',
    PANNE: 'reparation',
    'A-DETERMINER': 'diagnostic',
  };
  const reception = ctx.utilisateurs.get('receptionnaire') ?? null;
  const clientParId = new Map(clients.map((c) => [c.id, c]));
  let n = 0;
  const creer = async (p: {
    siteCode: string;
    clientId: string;
    vehiculeId: string | null;
    dateJour: Date;
    h: number;
    statut: 'confirme' | 'honore' | 'absent' | 'annule';
    motifCode?: string;
  }): Promise<string | null> => {
    const motif = p.motifCode
      ? motifs.find((m) => m.code === p.motifCode)
      : motifs[n % motifs.length];
    if (!motif) return null;
    n++;
    const d = new Date(p.dateJour);
    const stamp = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), p.h - 1, 0, 0),
    );
    return ins(ctx, 'rendez_vous', {
      siteId: ctx.sites.get(p.siteCode),
      clientId: p.clientId,
      vehiculeId: p.vehiculeId,
      motifId: motif.id,
      type: typeParMotif[motif.code] ?? 'service',
      date: iso(d),
      moment: p.h < 12 ? 'matin' : 'apres_midi',
      heureSouhaitee: heure(p.h, p.h % 2 === 0 ? 0 : 30),
      dureeEstimeeMinutes: motif.duree_defaut_minutes ?? 60,
      statut: p.statut,
      motifAnnulation: p.statut === 'annule' ? 'Annulé par le client (empêchement)' : null,
      origine: 'reservation',
      confirmeLe: new Date(stamp.getTime() - 3 * 86400_000),
      honoreLe: p.statut === 'honore' ? stamp : null,
      absentConstateLe: p.statut === 'absent' ? new Date(stamp.getTime() + 3600_000) : null,
      annuleLe: p.statut === 'annule' ? new Date(stamp.getTime() - 86400_000) : null,
      creeParId: reception,
      creeLe: new Date(stamp.getTime() - 4 * 86400_000),
    });
  };
  // Les OR planifiés ont un rendez-vous confirmé le jour prévu.
  for (const p of res.orsPlanifies) {
    const rdvId = await creer({
      siteCode: p.siteCode,
      clientId: p.clientId,
      vehiculeId: p.vehiculeId,
      dateJour: p.date,
      h: 8,
      statut: 'confirme',
      motifCode: 'SERVICE',
    });
    if (rdvId) await maj(ctx, 'ordre_reparation', p.id, { rendezVousId: rdvId });
  }
  const horaires = [8, 9, 10, 11, 13, 14, 15, 16];
  let k = 0;
  for (let delta = -8; delta <= 10; delta++) {
    const d = jour(ctx, delta, 8);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const nb = delta === 0 ? 5 : entre(ctx, 2, 4);
    for (let j = 0; j < nb; j++) {
      const v = vehicules[(k * 7 + 3) % vehicules.length];
      if (!v) continue;
      const client = clientParId.get(v.clientId);
      if (!client) continue;
      let statut: 'confirme' | 'honore' | 'absent' | 'annule' = 'confirme';
      const h = horaires[(j * 2 + delta + 20) % horaires.length] ?? 9;
      if (delta < 0) statut = k % 9 === 4 ? 'absent' : k % 7 === 3 ? 'annule' : 'honore';
      else if (delta === 0) statut = h <= 9 ? 'honore' : 'confirme';
      if (delta === 0 && statut === 'honore' && h >= ctx.maintenant.getUTCHours() + 1)
        statut = 'confirme';
      await creer({
        siteCode: k % 2 === 0 ? 'SION' : 'MARTIGNY',
        clientId: client.id,
        vehiculeId: v.id,
        dateJour: d,
        h,
        statut,
      });
      k++;
    }
  }
  ctx.journaliser(
    `  ${String(n)} rendez-vous (semaine passée, aujourd’hui, jusqu’à +10 jours, deux sites)`,
  );
}

// ---------------------------------------------------------------------------------------------
// Pointage
// ---------------------------------------------------------------------------------------------

export async function semerPointages(ctx: Ctx, res: ResultatAtelier): Promise<void> {
  const curseur = new Map<string, number>(); // clé tech|jour -> minutes UTC depuis minuit
  const enCours = new Set<string>();
  let total = 0;
  const maintenantMin = ctx.maintenant.getUTCHours() * 60 + ctx.maintenant.getUTCMinutes();
  const aujourdhui = iso(ctx.maintenant);

  const poser = async (p: {
    techId: string;
    siteCode: string;
    jourDate: Date;
    dureeSec: number;
    nature: 'productif_ligne' | 'indirect';
    orId?: string;
    ligneId?: string;
    indirect?: string;
    enCours?: boolean;
  }): Promise<void> => {
    const cle = `${p.techId}|${iso(p.jourDate)}`;
    const debutMin = curseur.get(cle) ?? 6 * 60 + 30;
    const finMin = debutMin + Math.ceil(p.dureeSec / 60);
    const estAujourdhui = iso(p.jourDate) === aujourdhui;
    if (finMin > 16 * 60 + 30) return;
    if (estAujourdhui && finMin > maintenantMin - 5 && !p.enCours) return;
    if (p.enCours && (enCours.has(p.techId) || !estAujourdhui)) return;
    curseur.set(cle, finMin + 5);
    const j = new Date(
      Date.UTC(p.jourDate.getUTCFullYear(), p.jourDate.getUTCMonth(), p.jourDate.getUTCDate()),
    );
    const debut = new Date(j.getTime() + debutMin * 60_000);
    const fin = p.enCours ? null : new Date(j.getTime() + finMin * 60_000);
    const joursAgo = Math.floor((ctx.maintenant.getTime() - j.getTime()) / 86400_000);
    const statut = p.enCours
      ? 'en_cours'
      : joursAgo > 35
        ? 'verrouille'
        : joursAgo > 3
          ? 'valide'
          : 'termine';
    if (p.enCours) enCours.add(p.techId);
    await ins(ctx, 'pointage', {
      siteId: ctx.sites.get(p.siteCode),
      technicienId: p.techId,
      statut,
      nature: p.nature,
      ordreReparationId: p.orId ?? null,
      ligneOrId: p.ligneId ?? null,
      activiteIndirecte: p.indirect ?? null,
      source: 'ecran_atelier',
      debutLe: debut,
      finLe: fin,
      dureeArrondieCentiemes: fin ? Math.round(p.dureeSec / 36) : null,
      clotureAutomatique: false,
      creeLe: debut,
    });
    total++;
  };

  for (const [techId, lignes] of res.lignesOrParTech) {
    for (const l of lignes) {
      const jr = jourOuvre(l.jour > ctx.maintenant ? ctx.maintenant : l.jour);
      if (l.statut === 'en_cours') {
        await poser({
          techId,
          siteCode: l.siteCode,
          jourDate: ctx.maintenant,
          dureeSec: 2400,
          nature: 'productif_ligne',
          orId: l.orId,
          ligneId: l.ligneId,
          enCours: true,
        });
      } else {
        await poser({
          techId,
          siteCode: l.siteCode,
          jourDate: jr,
          dureeSec: l.duree,
          nature: 'productif_ligne',
          orId: l.orId,
          ligneId: l.ligneId,
        });
      }
    }
  }
  // Activités indirectes d'hier et d'aujourd'hui pour chaque technicien.
  const techs = ['technicien', 'technicien-rey', 'technicien-fournier', 'technicien-bonvin'];
  for (const cle of techs) {
    const techId = ctx.utilisateurs.get(cle);
    if (!techId) continue;
    const site = cle === 'technicien-fournier' ? 'MARTIGNY' : 'SION';
    for (const delta of [-1, 0]) {
      const jr = jourOuvre(jour(ctx, delta, 8));
      await poser({
        techId,
        siteCode: site,
        jourDate: jr,
        dureeSec: 900,
        nature: 'indirect',
        indirect: 'nettoyage',
      });
      await poser({
        techId,
        siteCode: site,
        jourDate: jr,
        dureeSec: 1200,
        nature: 'indirect',
        indirect: 'magasin',
      });
      await poser({
        techId,
        siteCode: site,
        jourDate: jr,
        dureeSec: 1800,
        nature: 'indirect',
        indirect: delta === -1 ? 'formation' : 'attente_pieces',
      });
    }
  }
  ctx.journaliser(
    `  ${String(total)} pointages (temps sur OR, activités indirectes, pointages en cours)`,
  );
}

// ---------------------------------------------------------------------------------------------
// Courtoisie
// ---------------------------------------------------------------------------------------------

export async function semerCourtoisie(
  ctx: Ctx,
  clients: ClientDemo[],
  res: ResultatAtelier,
): Promise<void> {
  const reception = ctx.utilisateurs.get('receptionnaire') ?? null;
  const parc: Array<[string, string, number, string, string | null]> = [
    ['Fiat 500 — rouge', 'VS 77001', 18400, 'disponible', null],
    ['Dacia Sandero — blanche', 'VS 77002', 31200, 'disponible', null],
    ['Volkswagen up! — grise', 'VS 77003', 22750, 'disponible', null],
    [
      'Renault Zoé électrique — bleue',
      'VS 77004',
      12900,
      'disponible',
      'Câble de recharge dans le coffre',
    ],
    ['Toyota Aygo — noire', 'VD 77005', 41800, 'en_entretien', 'Révision en cours'],
  ];
  const ids: string[] = [];
  for (const [designation, plaque, kilometrage, etat, note] of parc) {
    ids.push(
      await ins(ctx, 'vehicule_courtoisie', { designation, plaque, kilometrage, etat, note }),
    );
  }
  const prets: Array<{
    v: number;
    debut: number;
    fin: number;
    rendu: number | null;
    statut: string;
    clientIdx: number;
    or?: number;
  }> = [
    { v: 0, debut: -2, fin: 1, rendu: null, statut: 'en_cours', clientIdx: 0, or: 1 },
    { v: 1, debut: -5, fin: -1, rendu: null, statut: 'en_cours', clientIdx: 1, or: 3 },
    { v: 2, debut: -21, fin: -19, rendu: -19, statut: 'retourne', clientIdx: 2 },
    { v: 3, debut: -14, fin: -12, rendu: -12, statut: 'retourne', clientIdx: 3 },
    { v: 0, debut: -33, fin: -31, rendu: -30, statut: 'retourne', clientIdx: 4 },
    { v: 2, debut: 2, fin: 3, rendu: null, statut: 'reserve', clientIdx: 5 },
    { v: 3, debut: -9, fin: -8, rendu: null, statut: 'annule', clientIdx: 6 },
  ];
  for (const p of prets) {
    const vehicule = ids[p.v];
    const orLie = p.or !== undefined ? res.orsActifs[p.or] : undefined;
    const client = orLie ? orLie.clientId : clients[p.clientIdx * 3 + 1]?.id;
    if (!vehicule || !client) continue;
    const kmDepart = parc[p.v]?.[2] ?? 10000;
    await ins(ctx, 'pret_courtoisie', {
      vehiculeCourtoisieId: vehicule,
      clientId: client,
      ordreReparationId: orLie?.id ?? null,
      debutLe: jour(ctx, p.debut, 8, 30),
      finPrevueLe: jour(ctx, p.fin, 17),
      renduLe: p.rendu !== null ? jour(ctx, p.rendu, 16, 45) : null,
      kmDepart,
      kmRetour: p.rendu !== null ? kmDepart + entre(ctx, 40, 320) : null,
      statut: p.statut,
      note:
        p.statut === 'annule'
          ? 'Annulé : le client a finalement pris le train'
          : p.statut === 'en_cours' && p.fin < 0
            ? 'Retard de restitution : client relancé'
            : null,
      creeParId: reception,
      creeLe: jour(ctx, p.debut, 8, 15),
    });
  }
  ctx.journaliser(
    `  ${String(parc.length)} véhicules de courtoisie, ${String(prets.length)} prêts (en cours, en retard, terminés, réservé, annulé)`,
  );
}

// ---------------------------------------------------------------------------------------------
// Contrôle qualité, devis complémentaires
// ---------------------------------------------------------------------------------------------

export async function semerControlesEtDevisComplementaires(ctx: Ctx): Promise<void> {
  const chef = ctx.utilisateurs.get('chef_atelier') ?? null;
  const ors = await sql<{ id: string; statut: string; ouvert_le: Date }>(
    ctx,
    `select id, statut, ouvert_le from ordre_reparation where tenant_id = $1 and statut in ('controle','termine','facture','restitue','cloture') order by ouvert_le desc limit 18`,
    [ctx.tenantId],
  );
  let nc = 0;
  for (const [i, o] of ors.entries()) {
    const conforme = !(o.statut === 'termine' && i === 0);
    await ins(ctx, 'or_controle_qualite', {
      ordreReparationId: o.id,
      controleurId: chef,
      controleLe: new Date(o.ouvert_le.getTime() + 8 * 3600_000),
      conforme,
      motifNonConformite: conforme
        ? null
        : 'Essai routier : léger bruit au freinage, reprise des disques demandée',
    });
    nc++;
  }
  const lignes = await sql<{
    id: string;
    ordre_reparation_id: string;
    montant_ttc_centimes: number;
  }>(
    ctx,
    `select l.id, l.ordre_reparation_id, l.montant_ttc_centimes from ligne_or l join ordre_reparation o on o.tenant_id = l.tenant_id and o.id = l.ordre_reparation_id
          where l.tenant_id = $1 and l.statut = 'a_valider' and o.statut in ('ouvert','en_cours') order by l.id limit 4`,
    [ctx.tenantId],
  );
  const emetteur = ctx.utilisateurs.get('receptionnaire') ?? null;
  for (const [i, l] of lignes.entries()) {
    const accepte = i === 1;
    const devisId = await ins(ctx, 'devis_complementaire', {
      ordreReparationId: l.ordre_reparation_id,
      numeroOrdre: 1,
      montantTtcCentimes: l.montant_ttc_centimes,
      envoyeLe: jour(ctx, -(i + 1), 11),
      canal: accepte ? 'telephone' : 'sms',
      emetteurId: emetteur,
      interlocuteurNom: 'Client',
      repondu_le: accepte ? jour(ctx, -1, 15) : null,
      decision: accepte ? 'accepte' : null,
      retranscription: accepte ? 'Accord par téléphone, à faire pendant l’immobilisation.' : null,
    });
    await ins(ctx, 'devis_complementaire_ligne', {
      devisComplementaireId: devisId,
      ligneOrId: l.id,
      decision: accepte ? 'accepte' : null,
    });
    if (accepte) await maj(ctx, 'ligne_or', l.id, { statut: 'validee' });
  }
  ctx.journaliser(
    `  ${String(nc)} contrôles qualité, ${String(lignes.length)} devis complémentaires (en attente et accepté)`,
  );
}

// ---------------------------------------------------------------------------------------------
// Hôtel à pneus
// ---------------------------------------------------------------------------------------------

export async function semerPneus(ctx: Ctx, vehicules: VehiculeDemo[]): Promise<number> {
  const dimensions = [
    '205/55 R16',
    '225/45 R17',
    '195/65 R15',
    '235/55 R18',
    '215/60 R17',
    '185/60 R15',
  ];
  const etats = ['bon', 'bon', 'usure moyenne', 'neuf', 'à surveiller'];
  const specs: Array<{ saison: 'ete' | 'hiver'; statut: string; age: number; sortie?: string }> = [
    { saison: 'hiver', statut: 'en_depot', age: 20 },
    { saison: 'hiver', statut: 'en_depot', age: 40 },
    { saison: 'ete', statut: 'en_depot', age: 12 },
    { saison: 'hiver', statut: 'en_depot', age: 70 },
    { saison: 'ete', statut: 'en_depot', age: 150 },
    { saison: 'hiver', statut: 'en_depot', age: 95 },
    { saison: 'ete', statut: 'a_relancer', age: 210 },
    { saison: 'ete', statut: 'a_relancer', age: 230 },
    { saison: 'hiver', statut: 'a_relancer', age: 190 },
    { saison: 'ete', statut: 'monte', age: 3 },
    { saison: 'hiver', statut: 'sorti', age: 160, sortie: 'rendu_au_client' },
    { saison: 'ete', statut: 'sorti', age: 300, sortie: 'vehicule_vendu' },
    { saison: 'hiver', statut: 'en_depot', age: 8 },
    { saison: 'ete', statut: 'en_depot', age: 25 },
  ];
  for (const [i, s] of specs.entries()) {
    const v = vehicules[(i * 4 + 5) % vehicules.length];
    if (!v) continue;
    const site = i % 3 === 0 ? 'MARTIGNY' : 'SION';
    await ins(ctx, 'depot_pneus', {
      vehiculeId: v.id,
      siteId: ctx.sites.get(site),
      saison: s.saison,
      statut: s.statut,
      codeCase:
        s.statut === 'sorti' || s.statut === 'monte'
          ? null
          : `${s.saison === 'hiver' ? 'H' : 'E'}-${String(100 + i)}`,
      dimension: choisir(ctx, dimensions),
      etat: choisir(ctx, etats),
      entreLe: jour(ctx, -s.age, 10),
      dernierMouvementLe: jour(ctx, -Math.max(0, s.age - 2), 10),
      motifSortie: s.sortie ?? null,
      origine: 'dfa',
    });
  }
  return specs.length;
}

// ---------------------------------------------------------------------------------------------
// Ventes VN / VO
// ---------------------------------------------------------------------------------------------

export async function semerVentes(ctx: Ctx, clients: ClientDemo[]): Promise<void> {
  const vendeur = ctx.utilisateurs.get('vendeur') ?? null;
  const comptable = ctx.utilisateurs.get('comptable') ?? null;
  const organismes = await sql<{ id: string; numero: string }>(
    ctx,
    `select id, numero from client where tenant_id = $1 and numero in ('CL-000004','CL-000005')`,
    [ctx.tenantId],
  );
  const credit = organismes.find((o) => o.numero === 'CL-000004');

  const vehiculesVente: Array<{
    marque: string;
    modele: string;
    version: string;
    carburant: string;
    prix: number;
    achat: number;
    prov: string;
    statut: string;
    site: string;
    annee: number;
    km?: number;
  }> = [
    {
      marque: 'Volkswagen',
      modele: 'Golf',
      version: '2.0 TDI Highline',
      carburant: 'diesel',
      prix: 2490000,
      achat: 2050000,
      prov: 'achat_particulier',
      statut: 'disponible',
      site: 'SION',
      annee: 2021,
      km: 48200,
    },
    {
      marque: 'BMW',
      modele: 'X3',
      version: 'xDrive20d',
      carburant: 'diesel',
      prix: 3790000,
      achat: 3200000,
      prov: 'retour_leasing',
      statut: 'reserve',
      site: 'MARTIGNY',
      annee: 2020,
      km: 61500,
    },
    {
      marque: 'Audi',
      modele: 'Q3',
      version: '35 TFSI S line',
      carburant: 'essence',
      prix: 3350000,
      achat: 2850000,
      prov: 'demonstrateur',
      statut: 'vendu',
      site: 'SION',
      annee: 2023,
      km: 14800,
    },
    {
      marque: 'Skoda',
      modele: 'Karoq',
      version: '1.5 TSI Style',
      carburant: 'essence',
      prix: 2790000,
      achat: 2300000,
      prov: 'neuf_constructeur',
      statut: 'livre',
      site: 'SION',
      annee: 2024,
    },
    {
      marque: 'Toyota',
      modele: 'C-HR',
      version: 'Hybrid 1.8 Trend',
      carburant: 'hybride',
      prix: 2990000,
      achat: 2480000,
      prov: 'achat_particulier',
      statut: 'livre',
      site: 'MARTIGNY',
      annee: 2022,
      km: 33100,
    },
    {
      marque: 'Peugeot',
      modele: '2008',
      version: 'GT PureTech 130',
      carburant: 'essence',
      prix: 2290000,
      achat: 1890000,
      prov: 'reprise',
      statut: 'disponible',
      site: 'MARTIGNY',
      annee: 2021,
      km: 52700,
    },
  ];
  const stocks: Array<{ id: string; spec: (typeof vehiculesVente)[number] }> = [];
  for (const [i, s] of vehiculesVente.entries()) {
    const vehiculeId = await ins(ctx, 'vehicule', {
      vin: `VS${s.marque.slice(0, 1)}ZZZ${String(7000000 + i * 137)}XY${String(10000 + i)}`
        .slice(0, 17)
        .padEnd(17, '0'),
      marque: s.marque,
      modele: s.modele,
      version: s.version,
      carburant: s.carburant,
      couleur: choisir(ctx, ['Noir', 'Gris', 'Blanc', 'Bleu']),
      date_1re_circulation: `${String(s.annee)}-04-15`,
      statut: 'actif',
      origine: 'dfa',
    });
    const entree = jour(ctx, -(15 + i * 11), 10);
    await ins(
      ctx,
      'vehicule_stock',
      {
        id: vehiculeId,
        siteId: ctx.sites.get(s.site),
        provenance: s.prov,
        dateEntreeStock: iso(entree),
        prixAchatCentimes: s.achat,
        prixVenteAfficheCentimes: s.prix,
        statut: s.statut,
        receptionneLe: entree,
        reserveLe: ['reserve', 'vendu', 'livre'].includes(s.statut)
          ? jour(ctx, -(10 + i * 4), 11)
          : null,
        venduLe: ['vendu', 'livre'].includes(s.statut) ? jour(ctx, -(8 + i * 4), 11) : null,
        livreLe: s.statut === 'livre' ? jour(ctx, -(3 + i), 14) : null,
        origine: 'dfa',
      },
      { sansId: false },
    );
    if (s.km)
      await ins(ctx, 'vehicule_kilometrage', {
        vehiculeId,
        valeur: s.km,
        unite: 'km',
        releveLe: entree,
        source: 'reception',
        saisiParId: vendeur,
      });
    stocks.push({ id: vehiculeId, spec: s });
  }

  const dossiers: Array<{
    stock: number;
    acheteur: number;
    statut: string;
    fin: 'comptant' | 'credit' | 'leasing';
    facture?: boolean;
    reprise?: boolean;
  }> = [
    { stock: 1, acheteur: 8, statut: 'engage', fin: 'credit' },
    { stock: 2, acheteur: 12, statut: 'pret_a_livrer', fin: 'comptant', reprise: true },
    { stock: 3, acheteur: 15, statut: 'livre', fin: 'leasing', facture: true },
    { stock: 4, acheteur: 18, statut: 'clos', fin: 'comptant', facture: true },
    { stock: 5, acheteur: 21, statut: 'abandonne', fin: 'credit' },
  ];
  let nbDossiers = 0;
  for (const [di, d] of dossiers.entries()) {
    const stock = stocks[d.stock];
    const acheteur = clients[d.acheteur];
    if (!stock || !acheteur) continue;
    const base = 6 + di * 4;
    const dossierId = await ins(ctx, 'dossier_vente', {
      siteId: ctx.sites.get(stock.spec.site),
      statut: d.statut,
      vehiculeId: stock.id,
      clientAcheteurId: acheteur.id,
      clientFactureId: acheteur.id,
      dateLivraisonEstimee: iso(jour(ctx, d.statut === 'engage' ? 12 : -2, 9)),
      dateLivraisonEffective: ['livre', 'clos'].includes(d.statut)
        ? iso(jour(ctx, -(3 + d.stock), 9))
        : null,
      identitePieceType: 'permis_conduire',
      identiteVerifieeLe: jour(ctx, -base, 10),
      engageLe: jour(ctx, -base, 11),
      enPreparationLe: ['pret_a_livrer', 'livre', 'clos'].includes(d.statut)
        ? jour(ctx, -base + 2, 9)
        : null,
      pretALivrerLe: ['pret_a_livrer', 'livre', 'clos'].includes(d.statut)
        ? jour(ctx, -base + 4, 9)
        : null,
      livreLe: ['livre', 'clos'].includes(d.statut) ? jour(ctx, -(3 + d.stock), 14) : null,
      closLe: d.statut === 'clos' ? jour(ctx, -2, 10) : null,
      abandonneLe: d.statut === 'abandonne' ? jour(ctx, -9, 10) : null,
      motifCloture:
        d.statut === 'abandonne' ? 'Le client a trouvé une offre moins chère ailleurs' : null,
      creeLe: jour(ctx, -base - 2, 10),
      origine: 'dfa',
    });
    nbDossiers++;
    for (const [code, libelle, fourni] of [
      ['permis', 'Permis de conduire', true],
      ['assurance', 'Attestation d’assurance RC', d.statut !== 'engage'],
      ['domicile', 'Attestation de domicile', d.statut === 'livre' || d.statut === 'clos'],
    ] as const) {
      await ins(ctx, 'dossier_vente_document_requis', {
        dossierVenteId: dossierId,
        code,
        libelle,
        fourni,
        fourniLe: fourni ? jour(ctx, -base + 1, 10) : null,
      });
    }
    // Financement
    const montant = Math.round((stock.spec.prix * 0.8) / 100) * 100;
    await ins(ctx, 'financement_vente', {
      dossierVenteId: dossierId,
      type: d.fin,
      organismeId: d.fin === 'comptant' ? null : (credit?.id ?? null),
      referenceContrat: d.fin === 'comptant' ? null : `CT-${String(2026)}-${String(1000 + di)}`,
      statut:
        d.statut === 'abandonne' ? 'refuse' : d.statut === 'engage' ? 'en_attente' : 'confirme',
      confirmeLe:
        d.statut === 'engage' || d.statut === 'abandonne' ? null : jour(ctx, -base + 2, 10),
      refuseLe: d.statut === 'abandonne' ? jour(ctx, -10, 10) : null,
      motifRefus: d.statut === 'abandonne' ? 'Capacité de remboursement insuffisante' : null,
      montantFinanceCentimes: d.fin === 'comptant' ? null : montant,
      acompteCentimes: d.fin === 'comptant' ? null : stock.spec.prix - montant,
      mensualiteCentimes: d.fin === 'comptant' ? null : Math.round(montant / 48),
      tauxInteretPourmille: d.fin === 'comptant' ? null : 39,
      dureeMois: d.fin === 'comptant' ? null : 48,
    });
    // Reprise
    if (d.reprise) {
      const reprId = await ins(ctx, 'vehicule', {
        vin: null,
        marque: 'Opel',
        modele: 'Astra',
        version: '1.6 CDTI',
        carburant: 'diesel',
        date_1re_circulation: '2016-06-01',
        statut: 'actif',
        origine: 'dfa',
      });
      await ins(ctx, 'reprise', {
        dossierVenteId: dossierId,
        vehiculeRepriseId: reprId,
        statut: 'confirmee',
        valeurEstimeeCentimes: 650000,
        valeurNegocieeCentimes: 580000,
        estimeeLe: jour(ctx, -base, 11),
        negocieeLe: jour(ctx, -base + 1, 11),
        confirmeeLe: jour(ctx, -base + 2, 11),
        origine: 'dfa',
      });
    }
    // Bon de commande, et facture pour les ventes livrées
    if (d.statut !== 'abandonne') {
      const bon = await creerDocument(ctx, {
        type: 'bon_commande',
        siteId: ctx.sites.get(stock.spec.site) as string,
        client: acheteur,
        vehiculeId: stock.id,
        dossierVenteId: dossierId,
        date: jour(ctx, -base, 11),
        lignes: [
          {
            type: 'forfait',
            designation: `Véhicule — ${stock.spec.marque} ${stock.spec.modele} ${stock.spec.version}`,
            quantiteMilli: 1000,
            ttcCentimes: stock.spec.prix,
          },
        ],
        emettre: true,
      });
      void bon;
    }
    if (d.facture) {
      const date = jour(ctx, -(3 + d.stock), 15);
      const fact = await creerDocument(ctx, {
        type: 'facture',
        siteId: ctx.sites.get(stock.spec.site) as string,
        client: acheteur,
        vehiculeId: stock.id,
        dossierVenteId: dossierId,
        date,
        delaiJours: 10,
        lignes: [
          {
            type: 'forfait',
            designation: `Véhicule — ${stock.spec.marque} ${stock.spec.modele} ${stock.spec.version}`,
            quantiteMilli: 1000,
            ttcCentimes: stock.spec.prix,
          },
          {
            type: 'forfait',
            designation: 'Frais d’immatriculation et de mise en circulation',
            quantiteMilli: 1000,
            ttcCentimes: 49000 + tvaDe(49000),
          },
        ],
        emettre: true,
      });
      await encaisser(
        ctx,
        fact,
        { regle: 0, total: fact.totalTtc },
        {
          siteId: ctx.sites.get(stock.spec.site) as string,
          client: acheteur,
          date,
          moyen: 'virement',
          montant: fact.totalTtc,
          auteurId: comptable,
        },
      );
    }
  }
  ctx.journaliser(
    `  ${String(stocks.length)} véhicules en stock (disponible, réservé, vendu, livré), ${String(nbDossiers)} dossiers de vente, financements, reprise, bons de commande`,
  );
}

// ---------------------------------------------------------------------------------------------
// Relances
// ---------------------------------------------------------------------------------------------

export async function semerRelances(
  ctx: Ctx,
  clients: ClientDemo[],
  res: ResultatAtelier,
): Promise<void> {
  const clientParId = new Map(clients.map((c) => [c.id, c]));
  const regles: Array<[string, number[]]> = [
    ['devis_sans_reponse', [7, 21]],
    ['expertise_mfk', [30]],
    ['pneus_saisonniers', [3]],
    ['depot_pneu_oublie', [30]],
    ['travail_reporte_urgent', [14]],
    ['campagne_constructeur', [30]],
    ['vehicule_pret_non_restitue', [1]],
    ['devis_complementaire_attente', [2]],
  ];
  for (const [type, delais] of regles) {
    await ins(ctx, 'regle_relance', {
      typeRelance: type,
      actif: type !== 'pneus_saisonniers',
      delaisJours: delais,
      canaux: ['email', 'sms'],
    });
  }
  let nb = 0;
  const planifier = async (p: {
    type: string;
    objetType: string;
    objetId: string;
    clientId: string;
    palier: number;
    statut: string;
    echeance: Date;
    envoi?: 'ok' | 'echec';
    canal?: 'email' | 'sms';
    annule?: string;
  }): Promise<void> => {
    const id = await ins(ctx, 'relance_planifiee', {
      typeRelance: p.type,
      objetType: p.objetType,
      objetId: p.objetId,
      palier: p.palier,
      clientId: p.clientId,
      echeancePrevue: p.echeance,
      statut: p.statut,
      annuleRaison: p.annule ?? null,
      creeLe: new Date(p.echeance.getTime() - 86400_000),
    });
    nb++;
    if (p.envoi) {
      const c = clientParId.get(p.clientId);
      const canal = p.canal ?? 'email';
      await ins(ctx, 'relance_envoi', {
        relancePlanifieeId: id,
        tentative: 1,
        canal,
        destinataireFige:
          canal === 'email'
            ? `${c?.designation.toLowerCase().replace(/[^a-z]+/g, '.') ?? 'client'}@bluewin.ch`
            : '+41791234567',
        langueFigee: 'fr',
        contenuFige:
          p.type === 'facture_echue'
            ? 'Bonjour, sauf erreur de notre part, votre facture reste ouverte. Nous vous remercions de procéder au règlement. Garage Martin SA'
            : 'Bonjour, nous revenons vers vous au sujet de votre véhicule. Garage Martin SA',
        statutEnvoi: p.envoi === 'ok' ? 'envoye' : 'echoue',
        fournisseurMessageId: p.envoi === 'ok' ? `msg-${id.slice(0, 8)}` : null,
        erreur: p.envoi === 'echec' ? 'Adresse e-mail refusée par le serveur destinataire' : null,
        envoyeLe: p.echeance,
        creeLe: p.echeance,
      });
    }
  };
  for (const f of res.facturesImpayees) {
    const echeance = f.doc.dateEcheance
      ? new Date(`${f.doc.dateEcheance}T09:00:00Z`)
      : jour(ctx, -10, 9);
    await planifier({
      type: 'facture_echue',
      objetType: 'document_vente',
      objetId: f.doc.id,
      clientId: f.client.id,
      palier: 1,
      statut: 'envoyee',
      echeance: ajouterJours(echeance, 10),
      envoi: 'ok',
      canal: 'sms',
    });
    if (f.niveau >= 2)
      await planifier({
        type: 'facture_echue',
        objetType: 'document_vente',
        objetId: f.doc.id,
        clientId: f.client.id,
        palier: 2,
        statut: f.niveau === 3 ? 'envoyee' : 'prete',
        echeance: ajouterJours(echeance, 30),
        envoi: f.niveau === 3 ? 'ok' : undefined,
        canal: 'email',
      });
  }
  for (const [i, d] of res.devisSansReponse.entries()) {
    await planifier({
      type: 'devis_sans_reponse',
      objetType: 'document_vente',
      objetId: d.doc.id,
      clientId: d.client.id,
      palier: 1,
      statut: i === 0 ? 'a_planifier' : 'prete',
      echeance: ajouterJours(d.doc.dateDocument, 7),
    });
  }
  // Expertises MFK proches ou échues
  const mfk = await sql<{ vehicule_id: string; client_id: string; prochaine_echeance: string }>(
    ctx,
    `select e.vehicule_id, d.client_id, e.prochaine_echeance::text from vehicule_expertise e
            join vehicule_detention d on d.tenant_id = e.tenant_id and d.vehicule_id = e.vehicule_id and d.au is null
           where e.tenant_id = $1 and e.prochaine_echeance < current_date + 45 order by e.prochaine_echeance limit 10`,
    [ctx.tenantId],
  );
  for (const [i, m] of mfk.entries()) {
    await planifier({
      type: 'expertise_mfk',
      objetType: 'vehicule',
      objetId: m.vehicule_id,
      clientId: m.client_id,
      palier: 1,
      statut:
        i % 4 === 0 ? 'envoyee' : i % 4 === 1 ? 'prete' : i % 4 === 2 ? 'a_planifier' : 'annulee',
      annule: i % 4 === 3 ? 'objet_traite' : undefined,
      echeance: new Date(`${m.prochaine_echeance}T08:00:00Z`),
      envoi: i % 4 === 0 ? 'ok' : undefined,
    });
  }
  const depots = await sql<{ id: string; client_id: string }>(
    ctx,
    `select p.id, d.client_id from depot_pneus p join vehicule_detention d on d.tenant_id = p.tenant_id and d.vehicule_id = p.vehicule_id and d.au is null
           where p.tenant_id = $1 and p.statut = 'a_relancer' limit 3`,
    [ctx.tenantId],
  );
  for (const [i, p] of depots.entries()) {
    await planifier({
      type: 'depot_pneu_oublie',
      objetType: 'depot_pneu',
      objetId: p.id,
      clientId: p.client_id,
      palier: 1,
      statut: i === 0 ? 'envoyee' : 'prete',
      echeance: jour(ctx, -(3 + i), 9),
      envoi: i === 0 ? 'echec' : undefined,
    });
  }
  const urgents = await sql<{ id: string; client_id: string }>(
    ctx,
    `select t.id, d.client_id from vehicule_travail_reporte t join vehicule_detention d on d.tenant_id = t.tenant_id and d.vehicule_id = t.vehicule_id and d.au is null
           where t.tenant_id = $1 and t.urgence = 'urgent' limit 3`,
    [ctx.tenantId],
  );
  for (const t of urgents)
    await planifier({
      type: 'travail_reporte_urgent',
      objetType: 'vehicule_travail_reporte',
      objetId: t.id,
      clientId: t.client_id,
      palier: 1,
      statut: 'prete',
      echeance: jour(ctx, 1, 9),
    });
  const campagnes = await sql<{ id: string; client_id: string }>(
    ctx,
    `select c.id, d.client_id from vehicule_campagne c join vehicule_detention d on d.tenant_id = c.tenant_id and d.vehicule_id = c.vehicule_id and d.au is null
           where c.tenant_id = $1 and c.statut = 'ouverte' limit 3`,
    [ctx.tenantId],
  );
  for (const c of campagnes)
    await planifier({
      type: 'campagne_constructeur',
      objetType: 'vehicule_campagne',
      objetId: c.id,
      clientId: c.client_id,
      palier: 1,
      statut: 'a_planifier',
      echeance: jour(ctx, 3, 9),
    });
  ctx.journaliser(
    `  ${String(regles.length + 1)} règles de relance, ${String(nb)} relances (envoyées, prêtes, à planifier, annulée, échec d’envoi)`,
  );
}

// ---------------------------------------------------------------------------------------------
// Export fiduciaire, mappings comptables, périodes
// ---------------------------------------------------------------------------------------------

export async function semerExportEtPeriodes(ctx: Ctx): Promise<void> {
  const direction = ctx.utilisateurs.get('direction') ?? null;
  const comptes: Array<[string, string, string, string]> = [
    ['creances_clients', 'debiteurs', '1100', 'Débiteurs clients'],
    ['produit', 'main_oeuvre', '3200', 'Produits main-d’œuvre'],
    ['produit', 'pieces', '3400', 'Produits pièces et fournitures'],
    ['produit', 'vehicules', '3000', 'Ventes de véhicules'],
    ['tva_due', 'tva', '2200', 'TVA due'],
    ['acomptes_recus', 'acomptes', '2030', 'Acomptes reçus'],
    ['financier', 'banque', '1020', 'Banque'],
    ['arrondi', 'arrondi', '3999', 'Différences d’arrondi'],
    ['escompte', 'escompte', '3900', 'Escomptes accordés'],
    ['perte', 'perte', '6900', 'Pertes sur débiteurs'],
    ['ecart_reprise', 'reprise', '3410', 'Écarts sur reprises'],
  ];
  for (const [usage, categorie, compte, libelle] of comptes) {
    await ins(ctx, 'mapping_compte', { usage, categorie, compte, libelle, actifDu: '2020-01-01' });
  }
  for (const cible of ['bexio', 'winbiz', 'abacus', 'banana']) {
    for (const [regime, taux, code] of [
      ['normal', 81, 'TVA81'],
      ['reduit', 26, 'TVA26'],
      ['hebergement', 38, 'TVA38'],
      ['exonere', 0, 'EXO'],
    ] as const) {
      await ins(ctx, 'mapping_code_tva', {
        cible,
        regimeTva: regime,
        tauxPourmille: taux,
        codeExterne: `${cible === 'bexio' ? '' : cible.slice(0, 2).toUpperCase() + '-'}${code}`,
      });
    }
  }
  const mois = (delta: number): { debut: Date; fin: Date; etiquette: string } => {
    const d = new Date(
      Date.UTC(ctx.maintenant.getUTCFullYear(), ctx.maintenant.getUTCMonth() + delta, 1),
    );
    const fin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { debut: d, fin, etiquette: iso(d).slice(0, 7) };
  };
  const exports: Array<{ delta: number; cible: string; statuts: string[] }> = [
    { delta: -4, cible: 'bexio', statuts: ['genere', 'transmis', 'accepte'] },
    { delta: -3, cible: 'bexio', statuts: ['genere', 'transmis', 'accepte'] },
    { delta: -2, cible: 'winbiz', statuts: ['genere', 'transmis'] },
    { delta: -1, cible: 'csv', statuts: ['genere'] },
  ];
  for (const e of exports) {
    const p = mois(e.delta);
    const docs = await sql<{
      id: string;
      type_document: string;
      numero: string;
      date_document: string;
      client_designation_figee: string;
      total_ht_centimes: string;
      total_tva_centimes: string;
      total_ttc_centimes: string;
    }>(
      ctx,
      `select id, type_document, numero, date_document::text, client_designation_figee, total_ht_centimes::text, total_tva_centimes::text, total_ttc_centimes::text
              from document_vente where tenant_id = $1 and type_document in ('facture','avoir') and statut <> 'brouillon' and exporte_le is null
               and date_document between $2 and $3 order by numero`,
      [ctx.tenantId, iso(p.debut), iso(p.fin)],
    );
    const paiements = await sql<{ id: string; montant: string }>(
      ctx,
      `select id, montant_centimes::text montant from paiement where tenant_id = $1 and exporte_le is null and date_valeur between $2 and $3`,
      [ctx.tenantId, iso(p.debut), iso(p.fin)],
    );
    const factures = docs.filter((d) => d.type_document === 'facture');
    const avoirs = docs.filter((d) => d.type_document === 'avoir');
    const somme = (l: Array<Record<string, string>>, k: string): number =>
      l.reduce((a, d) => a + Number(d[k]), 0);
    const ht = somme(docs, 'total_ht_centimes'),
      tva = somme(docs, 'total_tva_centimes'),
      ttc = somme(docs, 'total_ttc_centimes');
    const encaisse = somme(paiements, 'montant');
    const csv = [
      'date;numero;client;ht;tva;ttc',
      ...docs.map(
        (d) =>
          `${d.date_document};${d.numero};${d.client_designation_figee};${d.total_ht_centimes};${d.total_tva_centimes};${d.total_ttc_centimes}`,
      ),
    ].join('\n');
    const contenu = gzipSync(Buffer.from(csv, 'utf8'));
    const exportId = await ins(ctx, 'export_comptable', {
      cible: e.cible,
      mode: 'detaille',
      periodeDebut: iso(p.debut),
      periodeFin: iso(p.fin),
      genereLe: ajouterJours(p.fin, 2),
      genereParId: direction,
      nbEcritures: 3 * docs.length + 2 * paiements.length,
      totalDebitCentimes: Math.abs(ttc) + encaisse,
      totalCreditCentimes: Math.abs(ttc) + encaisse,
      empreinteSha256: createHash('sha256').update(csv).digest('hex'),
      statut: 'genere',
      nbFactures: factures.length,
      nbAvoirs: avoirs.length,
      nbEncaissements: paiements.length,
      totalHtCentimes: ht,
      totalTvaCentimes: tva,
      totalTtcCentimes: ttc,
      facturePremier: factures[0]?.numero ?? null,
      factureDernier: factures[factures.length - 1]?.numero ?? null,
      avoirPremier: avoirs[0]?.numero ?? null,
      avoirDernier: avoirs[avoirs.length - 1]?.numero ?? null,
      creeLe: ajouterJours(p.fin, 2),
    });
    for (const s of e.statuts.slice(1))
      await maj(ctx, 'export_comptable', exportId, {
        statut: s,
        reponseCible: {
          reference: `${e.cible.toUpperCase()}-${p.etiquette}`,
          recuLe: iso(ajouterJours(p.fin, 4)),
        },
      });
    await ins(ctx, 'export_comptable_fichier', {
      exportId,
      nomFichier: `export-${e.cible}-${p.etiquette}.csv.gz`,
      typeMime: 'application/gzip',
      tailleOctets: contenu.length,
      contenuGz: contenu,
    });
    if (docs.length > 0) {
      await ctx.c.query(
        `update document_vente set exporte_le = $3, export_id = $4 where tenant_id = $1 and id = any($2::uuid[])`,
        [ctx.tenantId, docs.map((d) => d.id), ajouterJours(p.fin, 2), exportId],
      );
    }
    if (paiements.length > 0) {
      await ctx.c.query(
        `update paiement set exporte_le = $3, export_id = $4 where tenant_id = $1 and id = any($2::uuid[])`,
        [ctx.tenantId, paiements.map((x) => x.id), ajouterJours(p.fin, 2), exportId],
      );
      await ctx.c.query(
        `update imputation_paiement set exporte_le = $3, export_id = $4 where tenant_id = $1 and paiement_id = any($2::uuid[])`,
        [ctx.tenantId, paiements.map((x) => x.id), ajouterJours(p.fin, 2), exportId],
      );
    }
  }
  // Périodes comptables : les mois exportés et acceptés sont clôturés.
  for (const delta of [-4, -3, -2, -1, 0]) {
    const p = mois(delta);
    await ins(ctx, 'periode_comptable', {
      debut: iso(p.debut),
      fin: iso(p.fin),
      clotureeLe: delta <= -3 ? ajouterJours(p.fin, 5) : null,
      clotureeParId: delta <= -3 ? direction : null,
    });
  }
  ctx.journaliser(
    `  ${String(exports.length)} exports fiduciaires (Bexio, WinBIZ, CSV), mappings comptables et TVA, périodes comptables`,
  );
  void choisir;
}
