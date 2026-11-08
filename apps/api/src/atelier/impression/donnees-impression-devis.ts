/**
 * Traduit un `ReponseDevisComplementaire` (déjà résolu et filtré par rôle par `ServiceOr.
 * obtenirComplet`, voir `service-impression-devis.ts`) en un DTO d'affichage PUR — aucune
 * dépendance à `pdfkit` — même séparation que `donnees-impression-or.ts` : `generation-pdf-
 * devis.ts` reste un pur exercice de MISE EN PAGE, et ce module se teste sans parser le flux
 * binaire d'un PDF.
 *
 * CONTENU, à la différence de la feuille d'atelier (§114, montants bannis pour tout le monde) :
 * un devis complémentaire EST un document d'argent — c'est même tout son objet (accord du client
 * sur un dépassement de plafond chiffré). `service-impression-devis.ts` refuse donc l'impression
 * en amont pour tout rôle sans droit aux montants (`ROLES_SANS_MONTANT`) ; ce module suppose que
 * `ligne.montants` est TOUJOURS présent sur les lignes qu'il reçoit et lève `ERREUR_INTERNE` sinon
 * (défense en profondeur, ne devrait jamais se produire — même patron que
 * `generation-pdf-facture.ts::exigerMontantsVisibles`).
 *
 * PAS de « date de validité » du devis : contrairement à ce qu'on pourrait attendre d'un devis
 * classique, ce concept n'existe NULLE PART dans le modèle métier (`docs/specification-etape-1-
 * atelier-clients.md` §7.6, RM-79 → RM-86) : le devis reste ouvert jusqu'à ce que LE GARAGE enregistre la réponse du
 * client (téléphone/SMS/e-mail/comptoir/lien) — il n'y a pas d'échéance que le client détiendrait.
 * Inventer une durée arbitraire (« valable 30 jours ») aurait été une donnée fabriquée. Ce module
 * imprime à la place le vrai analogue métier : le STATUT réel du devis (en attente de réponse /
 * répondu, avec décision et date) — voir `statutDevis`. Signalé au coordinateur : si le métier veut
 * une vraie date d'expiration, c'est une décision de modèle de données (nouvelle colonne), pas une
 * décision d'impression.
 *
 * PAS d'adresse postale du client : `ReponseOrdreReparation.figees.adresseFacturation` est un
 * JSONB NON TYPÉ (`Record<string, unknown> | null`, `packages/shared/contrats/atelier/ordre-
 * reparation.ts::ValeursFigeesOr`) — contrairement à l'adresse structurée de `ReponseDocumentVente.
 * figees` côté facturation. Le lire sans validation violerait « jamais de `any`, types stricts
 * partout » (CONTRIBUTING.md). Ce module imprime `document.figees.clientDesignation` (nom, typé `string`)
 * et `document.client.localite` (typé `string | null`) — pas de rue/NPA client, faute d'un champ
 * fiable côté contrat.
 */

import type {
  CanalDevis,
  ReponseDevisComplementaire,
  ReponseLigneOr,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { ErreurMetier } from '../../common/erreurs/erreur-metier';

import { formaterDateHeureSuisse, formaterDateSuisse } from './formatage-or';
import { formaterMontantCentimes } from '../../facturation/impression/formatage-suisse';
import { libellesImpressionDevis, type LibellesDevis } from './libelles-impression-devis';
import { libellesImpressionOr } from './libelles-impression-or';
import { libellesImpression } from '../../facturation/impression/libelles-impression';

/** Identité du garage à imprimer en en-tête — résolue par `service-impression-devis.ts` (lecture
 *  directe de `tenant`/`site`, hors du contrat `ReponseOrdreReparation` qui ne porte que `siteId`). */
export interface IdentiteGarage {
  readonly raisonSociale: string;
  readonly siteNom: string;
  readonly rue: string | null;
  readonly npa: string | null;
  readonly localite: string | null;
  /** N° TVA tel que saisi dans les réglages ; absent si non renseigné. */
  readonly numeroTva?: string | null;
  /** Réglage `tenant.assujetti_tva` ; absent = assujetti (comportement historique). */
  readonly assujettiTva?: boolean;
}

export interface LigneImprimeeDevis {
  /** `<type traduit> — <désignation>`, comme la feuille d'atelier — ici AVEC prix : c'est le point
   *  du document. Suffixée `[Accepté]`/`[Refusé]` quand une décision LIGNE PAR LIGNE existe déjà
   *  (`ReponseDevisLigne.decision`, cas `partiel`) — jamais inventée pour un devis pas encore
   *  répondu ou répondu globalement. */
  readonly designation: string;
  readonly quantite: string;
  /** `''` : prix unitaire non figé (cas théorique, ligne sans prix) — jamais `"CHF 0.00"`, qui
   *  mentirait sur un prix réel de zéro. */
  readonly prixUnitaire: string;
  readonly tauxTva: string;
  readonly montantTtc: string;
}

export interface VentilationTvaImprimee {
  readonly taux: string;
  readonly baseHt: string;
  readonly montantTva: string;
}

export interface DonneesImpressionDevis {
  readonly libelles: LibellesDevis;
  /** `<libellés.devisNumero>` — porte déjà le rang du devis ET le numéro d'OR, voir
   *  `LibellesDevis.devisNumero` : pas de champ `ordreReparationNumero` séparé, qui serait mort à
   *  l'impression (jamais lu par `generation-pdf-devis.ts` en dehors de ce titre composé). */
  readonly titre: string;
  readonly garageRaisonSociale: string;
  readonly garageSiteNom: string;
  readonly garageAdresseLigne1: string | null;
  readonly garageAdresseLigne2: string | null;
  readonly garageNumeroTva: string | null;
  /** Garage non assujetti ET devis sans aucune TVA : ni colonne TVA, ni récapitulatif, ni HT/TVA ;
   *  seul le total et {@link mentionNonAssujetti} (mêmes libellés que la facture) sont imprimés.
   *  Un devis dont des lignes portent encore de la TVA (figées avant le changement de statut du
   *  garage) garde son rendu complet : on n'efface jamais une TVA réellement calculée. */
  readonly sansTva: boolean;
  readonly mentionNonAssujetti: string;
  /** « Total » (sans « TTC ») pour le rendu {@link sansTva}. */
  readonly libelleTotalSansTva: string;
  readonly dateEnvoi: string;
  readonly canal: string;
  readonly statutDevis: string;
  readonly dateReponse: string | null;
  readonly interlocuteurNom: string | null;
  readonly clientDesignation: string;
  readonly clientLocalite: string | null;
  readonly vehiculeDesignation: string;
  readonly immatriculation: string;
  readonly vin: string;
  readonly lignes: readonly LigneImprimeeDevis[];
  readonly ventilationTva: readonly VentilationTvaImprimee[];
  readonly totalHt: string;
  readonly totalTva: string;
  readonly totalTtc: string;
  /** `null` : absent du devis (théoriquement jamais — `nouveauPlafondCentimes` est obligatoire au
   *  schéma d'entrée, `schemaCreationDevisComplementaire`) — la ligne est alors omise à l'impression. */
  readonly nouveauPlafond: string | null;
  readonly impactRestitution: string | null;
}

function montant(centimes: number): string {
  return `CHF ${formaterMontantCentimes(centimes)}`;
}

function exigerMontants(ligne: ReponseLigneOr): NonNullable<ReponseLigneOr['montants']> {
  if (!ligne.montants) {
    throw new ErreurMetier(
      'ERREUR_INTERNE',
      `Ligne ${ligne.id} sans montants au moment d'imprimer un devis complémentaire — le rôle ` +
        'appelant aurait dû être refusé en amont (voir ServiceImpressionDevis.garantirMontantsVisibles).',
    );
  }
  return ligne.montants;
}

function construireLigneImprimee(
  ligne: ReponseLigneOr,
  decisionLigne: string | null,
  typeLabel: string,
): LigneImprimeeDevis {
  const montants = exigerMontants(ligne);
  const suffixeDecision = decisionLigne ? ` [${decisionLigne}]` : '';
  return {
    designation: `${typeLabel} — ${ligne.designation}${suffixeDecision}`,
    quantite: String(ligne.quantiteMillieme / 1000),
    prixUnitaire: ligne.prixUnitaireCentimes != null ? montant(ligne.prixUnitaireCentimes) : '',
    tauxTva: `${(ligne.tauxTvaPourmille / 10).toFixed(1)}%`,
    montantTtc: montant(montants.montantTtcCentimes),
  };
}

interface AgregatTva {
  readonly ventilation: readonly VentilationTvaImprimee[];
  readonly totalHtCentimes: number;
  readonly totalTvaCentimes: number;
  readonly totalTtcCentimes: number;
}

/** TVA calculée PAR LIGNE (déjà figée, `ReponseLigneOr.montants`) puis AGRÉGÉE par taux —
 *  arithmétique entière exclusivement, jamais de flottant (CONTRIBUTING.md). Tri croissant par taux :
 *  rendu déterministe, indépendant de l'ordre d'affichage des lignes. */
function agregerTva(lignes: readonly ReponseLigneOr[]): AgregatTva {
  const parTaux = new Map<number, { baseCentimes: number; tvaCentimes: number }>();
  let totalHtCentimes = 0;
  let totalTvaCentimes = 0;
  let totalTtcCentimes = 0;

  for (const ligne of lignes) {
    const m = exigerMontants(ligne);
    totalHtCentimes += m.montantHtCentimes;
    totalTvaCentimes += m.montantTvaCentimes;
    totalTtcCentimes += m.montantTtcCentimes;

    const entree = parTaux.get(ligne.tauxTvaPourmille) ?? { baseCentimes: 0, tvaCentimes: 0 };
    parTaux.set(ligne.tauxTvaPourmille, {
      baseCentimes: entree.baseCentimes + m.montantHtCentimes,
      tvaCentimes: entree.tvaCentimes + m.montantTvaCentimes,
    });
  }

  const ventilation = [...parTaux.entries()]
    .sort(([a], [b]) => a - b)
    .map(([taux, v]) => ({
      taux: `${(taux / 10).toFixed(1)}%`,
      baseHt: montant(v.baseCentimes),
      montantTva: montant(v.tvaCentimes),
    }));

  return { ventilation, totalHtCentimes, totalTvaCentimes, totalTtcCentimes };
}

function construireStatutDevis(devis: ReponseDevisComplementaire, l: LibellesDevis): string {
  if (devis.repondueLe && devis.decision) {
    return l.statutRepondu(l.decisions[devis.decision]);
  }
  return l.statutEnAttente;
}

function construireAdresseSite(identite: IdentiteGarage): {
  ligne1: string | null;
  ligne2: string | null;
} {
  const ligne2 =
    identite.npa || identite.localite
      ? `${identite.npa ?? ''} ${identite.localite ?? ''}`.trim()
      : null;
  return { ligne1: identite.rue, ligne2 };
}

export function construireDonneesImpressionDevis(
  document: ReponseOrdreReparation,
  devis: ReponseDevisComplementaire,
  identite: IdentiteGarage,
): DonneesImpressionDevis {
  const langue = document.client.langueCorrespondance;
  const l = libellesImpressionDevis(langue);
  const typeLabels = libellesImpressionOr(langue).typeLigneOr;

  // Filtre RÉEL sur les données déjà chargées : ne garde que les lignes de l'OR effectivement
  // référencées par CE devis — jamais toutes les lignes de l'OR. `document.lignes` est déjà trié
  // par `numeroOrdre` (`service-or.ts`), donc ce filtre préserve l'ordre d'affichage naturel de
  // l'OR sans re-tri. Test décisif (piège CONTRIBUTING.md « filtre accepté ≠ appliqué ») : un OR à 3
  // lignes dont seules 2 sont soumises à ce devis ne doit imprimer QUE ces 2 lignes.
  const idsDevis = new Set(devis.lignes.map((dl) => dl.ligneId));
  const decisionParLigne = new Map(devis.lignes.map((dl) => [dl.ligneId, dl.decision]));
  const lignesDevis = document.lignes.filter((ligne) => idsDevis.has(ligne.id));

  const { ventilation, totalHtCentimes, totalTvaCentimes, totalTtcCentimes } =
    agregerTva(lignesDevis);
  const adresseSite = construireAdresseSite(identite);
  const libellesFacture = libellesImpression(langue);
  const sansTva =
    identite.assujettiTva === false && lignesDevis.every((x) => x.tauxTvaPourmille === 0);
  const canal: CanalDevis = devis.canal;

  return {
    libelles: l,
    titre: l.devisNumero(devis.numeroOrdre, document.numero),
    garageRaisonSociale: identite.raisonSociale,
    garageSiteNom: identite.siteNom,
    garageAdresseLigne1: adresseSite.ligne1,
    garageAdresseLigne2: adresseSite.ligne2,
    // Non assujetti : la mention remplace le n° TVA (même règle que l'en-tête de la facture).
    garageNumeroTva: sansTva ? libellesFacture.nonAssujettiTva : identite.numeroTva?.trim() || null,
    sansTva,
    mentionNonAssujetti: libellesFacture.nonAssujettiTva,
    libelleTotalSansTva: libellesFacture.total,
    dateEnvoi: formaterDateSuisse(devis.envoyeLe),
    canal: l.canaux[canal],
    statutDevis: construireStatutDevis(devis, l),
    dateReponse: devis.repondueLe ? formaterDateHeureSuisse(devis.repondueLe) : null,
    interlocuteurNom: devis.interlocuteurNom,
    clientDesignation: document.figees.clientDesignation,
    clientLocalite: document.client.localite,
    vehiculeDesignation: document.vehicule.designation,
    immatriculation: document.vehicule.plaque ?? l.plaqueNonRenseignee,
    vin: document.vehicule.vin ?? l.vinNonRenseigne,
    lignes: lignesDevis.map((ligne) =>
      construireLigneImprimee(
        ligne,
        decisionParLigne.get(ligne.id) ? l.decisions[decisionParLigne.get(ligne.id)!] : null,
        typeLabels[ligne.type],
      ),
    ),
    ventilationTva: ventilation,
    totalHt: montant(totalHtCentimes),
    totalTva: montant(totalTvaCentimes),
    totalTtc: montant(totalTtcCentimes),
    nouveauPlafond:
      devis.nouveauPlafondCentimes != null ? montant(devis.nouveauPlafondCentimes) : null,
    impactRestitution: devis.impactRestitutionLe
      ? formaterDateHeureSuisse(devis.impactRestitutionLe)
      : null,
  };
}
