/**
 * Jeu de démonstration « complet » — documents de vente : devis, factures, avoirs, paiements.
 *
 * Chemin légal respecté : un document naît en brouillon, reçoit ses lignes et sa ventilation TVA,
 * puis est ÉMIS (numéro continu du compteur, exercice, QR-facture). Une fois émis, seules les
 * colonnes de suivi (règlement, relance, export) bougent. Argent en centimes entiers, TVA 8.1 %
 * calculée par ligne puis agrégée, espèces arrondies à 5 centimes.
 */
import {
  arrondi5,
  htDeTtc,
  ins,
  iso,
  maj,
  payloadQr,
  prochainNumero,
  referenceQrr,
  sql,
  ajouterJours,
  type Ctx,
} from './seed-complement-outils';
import type { ClientDemo } from './seed-complement-personnes';

export interface LigneDocSpec {
  readonly type: string;
  readonly designation: string;
  readonly quantiteMilli: number;
  /** Total TTC de la ligne (centimes). */
  readonly ttcCentimes: number;
  readonly ligneOrId?: string;
}

export interface DocumentCree {
  readonly id: string;
  readonly numero: string | null;
  readonly totalTtc: number;
  readonly totalHt: number;
  readonly totalTva: number;
  readonly dateDocument: Date;
  readonly dateEcheance: string | null;
  readonly clientId: string;
}

export interface SpecDocument {
  readonly type: 'devis' | 'facture' | 'avoir' | 'bon_commande';
  readonly siteId: string;
  readonly client: Pick<ClientDemo, 'id' | 'designation' | 'ide' | 'langue' | 'adresse'>;
  readonly vehiculeId?: string | null;
  readonly orId?: string | null;
  readonly dossierVenteId?: string | null;
  readonly date: Date;
  readonly lignes: readonly LigneDocSpec[];
  readonly delaiJours?: number;
  readonly emettre: boolean;
  /** Pour un avoir. */
  readonly factureAnnulee?: {
    id: string;
    portee: 'total' | 'partiel';
    motif: string;
    motifLibre?: string;
  };
  readonly origineLignes?: 'or';
}

const PREFIXES: Record<string, string> = {
  devis: 'DEV',
  bon_commande: 'BDC',
  facture: 'FAC',
  avoir: 'AVO',
};

let bloc: {
  nom: string;
  rue: string;
  numero: string;
  npa: string;
  localite: string;
  iban: string;
  qrIban: string;
} | null = null;

async function blocCreancier(ctx: Ctx): Promise<NonNullable<typeof bloc>> {
  if (bloc) return bloc;
  const r = await sql<{
    nom: string;
    rue: string;
    numero: string;
    npa: string;
    localite: string;
    iban: string;
    qr_iban: string;
  }>(
    ctx,
    `select nom, rue, numero, npa, localite, iban, qr_iban from tenant_bloc_creancier where tenant_id = $1`,
    [ctx.tenantId],
  );
  const l = r[0];
  if (!l) throw new Error('Bloc créancier absent : seed-dev doit tourner avant.');
  bloc = {
    nom: l.nom,
    rue: l.rue,
    numero: l.numero,
    npa: l.npa,
    localite: l.localite,
    iban: l.iban,
    qrIban: l.qr_iban,
  };
  return bloc;
}

/** Séquence de référence QR propre au seed (au-dessus des références déjà posées par les services). */
async function prochaineReferenceQr(ctx: Ctx, exercice: number): Promise<string> {
  const n = (await prochainNumero(ctx, 'reference_qr', 2000)) + 1000;
  return referenceQrr(`${String(exercice)}${String(n).padStart(22, '0')}`);
}

export async function creerDocument(ctx: Ctx, spec: SpecDocument): Promise<DocumentCree> {
  // Jamais de document daté dans le futur : le jeu reste cohérent quel que soit le jour du lancement.
  const s: SpecDocument = spec.date > ctx.maintenant ? { ...spec, date: ctx.maintenant } : spec;
  const signe = s.type === 'avoir' ? -1 : 1;
  const lignes = s.lignes.map((l) => {
    const ht = htDeTtc(Math.abs(l.ttcCentimes));
    return {
      ...l,
      ht: ht * signe,
      tva: (Math.abs(l.ttcCentimes) - ht) * signe,
      ttc: Math.abs(l.ttcCentimes) * signe,
    };
  });
  const totalHt = lignes.reduce((a, l) => a + l.ht, 0);
  const totalTva = lignes.reduce((a, l) => a + l.tva, 0);
  const totalTtc = totalHt + totalTva;
  const dateISO = iso(s.date);
  const adresse = {
    rue: s.client.adresse.rue,
    npa: s.client.adresse.npa,
    pays: 'CH',
    numero: null,
    localite: s.client.adresse.localite,
  };

  const id = await ins(ctx, 'document_vente', {
    siteId: s.siteId,
    typeDocument: s.type,
    natureFacture: 'ordinaire',
    origine: 'dfa',
    statut: 'brouillon',
    statutReglement: 'non_regle',
    dateDocument: dateISO,
    clientId: s.client.id,
    vehiculeId: s.vehiculeId ?? null,
    ordreReparationId: s.orId ?? null,
    dossierVenteId: s.dossierVenteId ?? null,
    clientDesignationFigee: s.client.designation,
    clientIdeFige: s.client.ide,
    langueFigee: s.client.langue,
    adresseFacturationFigee: adresse,
    conditionsPaiementFigees: { modePaiement: 'facture', delaiPaiementJours: s.delaiJours ?? 30 },
    factureAnnuleeId: s.factureAnnulee?.id ?? null,
    porteeAvoir: s.factureAnnulee?.portee ?? null,
    motifAvoir: s.factureAnnulee?.motif ?? null,
    motifAvoirLibre: s.factureAnnulee?.motifLibre ?? null,
    tvaNonVentilee: false,
    mentionTvaInterdite: false,
    totalHtCentimes: totalHt,
    totalTvaCentimes: totalTva,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: totalTtc,
    montantRegleCentimes: 0,
    soldeCentimes: 0,
    devise: 'CHF',
    relanceNiveau: 0,
    contentieux: false,
    creeLe: s.date,
  });

  let n = 0;
  for (const l of lignes) {
    n += 1;
    await ins(ctx, 'ligne_document', {
      documentId: id,
      numeroOrdre: n,
      typeLigne: l.type,
      designation: l.designation,
      ligneOrId: l.ligneOrId ?? null,
      modeCalculTva: 'ttc',
      regimeTva: 'normal',
      tauxTvaPourmille: 81,
      datePrestation: dateISO,
      quantiteMillieme: l.quantiteMilli,
      prixUnitaireCentimes: Math.round(l.ttc / (l.quantiteMilli / 1000)),
      remiseGlobaleRepartieCentimes: 0,
      baseCentimes: l.ttc,
      htCentimes: l.ht,
      tvaCentimes: l.tva,
      ttcCentimes: l.ttc,
    });
  }
  await ins(ctx, 'document_vente_tva', {
    documentId: id,
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    baseCentimes: totalHt,
    tvaCentimes: totalTva,
  });

  if (!s.emettre) {
    return {
      id,
      numero: null,
      totalTtc,
      totalHt,
      totalTva,
      dateDocument: s.date,
      dateEcheance: null,
      clientId: s.client.id,
    };
  }

  const exercice = s.date.getUTCFullYear();
  const seq = await prochainNumero(ctx, `document_vente:${s.type}`, exercice);
  const numero = `${PREFIXES[s.type] ?? 'DOC'}-${String(exercice)}-${String(seq).padStart(5, '0')}`;
  const emisLe = new Date(s.date.getTime() + 3600_000);
  const champs: Record<string, unknown> = {
    statut: 'emis',
    numero,
    numeroSequence: seq,
    exercice,
    emisLe,
    dateEcheance:
      s.type === 'facture'
        ? iso(ajouterJours(s.date, s.delaiJours ?? 30))
        : s.type === 'devis'
          ? iso(ajouterJours(s.date, 30))
          : null,
    soldeCentimes: s.type === 'facture' || s.type === 'avoir' ? Math.abs(totalTtc) : 0,
  };
  if (s.type === 'facture') {
    const b = await blocCreancier(ctx);
    const reference = await prochaineReferenceQr(ctx, exercice);
    const qr = payloadQr({
      iban: b.qrIban,
      creancier: { nom: b.nom, rue: b.rue, numero: b.numero, npa: b.npa, localite: b.localite },
      montantCentimes: totalTtc,
      debiteur: {
        nom: s.client.designation,
        rue: s.client.adresse.rue,
        npa: s.client.adresse.npa,
        localite: s.client.adresse.localite,
      },
      reference,
      information: `Facture ${numero}`,
    });
    Object.assign(champs, {
      qrIban: b.qrIban,
      creancierNom: b.nom,
      creancierRue: b.rue,
      creancierNumero: b.numero,
      creancierNpa: b.npa,
      creancierLocalite: b.localite,
      creancierPays: 'CH',
      typeReferenceQr: 'qrr',
      qrReference: reference,
      qrMontantCentimes: totalTtc,
      qrDevise: 'CHF',
      qrLangue: s.client.langue,
      qrDebiteurPresent: true,
      qrPayload: qr.payload,
      qrPayloadSha256: qr.sha256,
    });
  }
  await maj(ctx, 'document_vente', id, champs);
  return {
    id,
    numero,
    totalTtc,
    totalHt,
    totalTva,
    dateDocument: s.date,
    dateEcheance: (champs['dateEcheance'] as string | null) ?? null,
    clientId: s.client.id,
  };
}

export async function changerStatutDocument(
  ctx: Ctx,
  id: string,
  statut: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await maj(ctx, 'document_vente', id, { statut, ...extra });
}

// ---------------------------------------------------------------------------------------------
// Paiements
// ---------------------------------------------------------------------------------------------

export interface SuiviReglement {
  regle: number;
  total: number;
}

export async function encaisser(
  ctx: Ctx,
  doc: DocumentCree,
  suivi: SuiviReglement,
  p: {
    siteId: string;
    client: Pick<ClientDemo, 'id' | 'designation'>;
    date: Date;
    moyen: string;
    montant: number;
    auteurId: string | null;
  },
): Promise<void> {
  const dateEffective = p.date > ctx.maintenant ? ctx.maintenant : p.date;
  p = { ...p, date: dateEffective };
  const reste = suivi.total - suivi.regle;
  const montant = Math.min(p.montant, reste);
  if (montant <= 0) return;
  const solde = montant === reste;
  let paye = montant;
  const imputations: Array<{ nature: string; montant: number }> = [];
  if (p.moyen === 'especes' && solde) {
    // Règle suisse : les espèces se paient à 5 centimes ; l'écart est imputé en « arrondi ».
    paye = arrondi5(montant);
    // L'arrondi (négatif ou positif) est posé AVANT le règlement : le trigger MD-51.a contrôle la
    // somme des imputations après chaque insertion.
    if (montant - paye !== 0) imputations.push({ nature: 'arrondi', montant: montant - paye });
    imputations.push({ nature: 'reglement', montant: paye });
  } else {
    imputations.push({ nature: 'reglement', montant });
  }
  const source =
    p.moyen === 'carte' || p.moyen === 'twint'
      ? 'terminal'
      : p.moyen === 'qr' || p.moyen === 'virement'
        ? ctx.rnd() < 0.5
          ? 'camt054'
          : 'manuel'
        : 'manuel';
  const paiementId = await ins(ctx, 'paiement', {
    siteId: p.siteId,
    dateValeur: iso(p.date),
    moyen: p.moyen,
    montantCentimes: paye,
    devise: 'CHF',
    payeurClientId: p.client.id,
    payeurLibelle: p.client.designation,
    source,
    identifiantTransactionBanque:
      source === 'camt054' ? `CAMT-${doc.numero ?? 'X'}-${String(paye)}` : null,
    creeParId: p.auteurId,
    origine: 'dfa',
    creeLe: p.date,
  });
  for (const i of imputations) {
    await ins(ctx, 'imputation_paiement', {
      paiementId,
      documentId: doc.id,
      montantCentimes: i.montant,
      nature: i.nature,
      imputeLe: p.date,
      imputeParId: p.auteurId,
      creeLe: p.date,
    });
  }
  suivi.regle += montant;
  await maj(ctx, 'document_vente', doc.id, {
    montantRegleCentimes: suivi.regle,
    soldeCentimes: suivi.total - suivi.regle,
    statutReglement: suivi.regle >= suivi.total ? 'regle' : 'partiel',
  });
}

/** Facture annulée par un avoir total : la facture passe à `annule_par_avoir`. */
export async function annulerParAvoir(ctx: Ctx, factureId: string, avoirId: string): Promise<void> {
  await maj(ctx, 'document_vente', factureId, {
    statut: 'annule_par_avoir',
    annuleParAvoirId: avoirId,
  });
}
