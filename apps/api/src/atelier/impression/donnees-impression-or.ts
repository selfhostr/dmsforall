/**
 * Traduit `ReponseOrdreReparation` (contrat API, déjà filtré par rôle par `ServiceOr.
 * assemblerDocument`) en un DTO d'affichage PUR — aucune dépendance à `pdfkit` — pour deux
 * raisons :
 *  1. `generation-pdf-or.ts` reste un pur exercice de MISE EN PAGE, sans logique métier ;
 *  2. ce module est testable SANS parser le flux binaire d'un PDF (`generation-pdf-or.spec.ts`
 *     aurait dû décoder les chaînes hexadécimales `<...>Tj` de `pdfkit` pour vérifier qu'un
 *     montant est bien absent — fragile et indirect ; `donnees-impression-or.spec.ts` vérifie la
 *     même règle directement sur les CHAÎNES avant tout rendu).
 *
 * Règle centrale (masquage des montants) : `document.totauxParPayeur` n'est présent QUE pour un
 * rôle qui voit les montants (`ServiceOr.assemblerDocument` / `atelier/mappeurs.ts::
 * roleVoitLesMontants`) — signal fiable, indépendant de la valeur réelle (même tableau vide si
 * l'OR n'a aucun groupe payeur tiers). Quand `voitMontants` est faux, `prixUnitaire`/`montant`
 * valent `null` sur CHAQUE ligne — jamais `"0.00"`, jamais un tiret : `null` signifie « colonne
 * absente », une valeur numérique signifierait « travail gratuit ».
 */

import type { ReponseOrdreReparation, ReponseLigneOr } from '@dfa/shared';

import {
  formaterDateHeureSuisse,
  formaterDateSuisse,
  formaterKilometrage,
  formaterMontantCentimes,
} from './formatage-or';
import { libellesImpressionOr, type LibellesOr } from './libelles-impression-or';

export interface LigneImprimeeOr {
  /** `<type traduit> — <désignation>`, ex. « Pièce — Plaquettes de frein avant ». */
  readonly designation: string;
  readonly quantite: string;
  /** `null` : colonne absente (rôle sans droit aux montants) — jamais `"0.00"`. */
  readonly prixUnitaire: string | null;
  /** `null` : colonne absente (rôle sans droit aux montants) — jamais `"0.00"`. */
  readonly montant: string | null;
}

export interface DonneesImpressionOr {
  readonly libelles: LibellesOr;
  readonly numero: string;
  /** `''` : site introuvable (ne devrait jamais arriver) — la ligne « Site » est alors omise. */
  readonly site: string;
  readonly dateOuverture: string;
  readonly type: string;
  readonly statut: string;
  readonly restitutionPromise: string;
  readonly vehiculeDesignation: string;
  readonly immatriculation: string;
  readonly vin: string;
  readonly kilometrageEntree: string;
  /** `null` : jamais relevé — la ligne « Kilométrage sortie » est alors omise (pas « 0 km »). */
  readonly kilometrageSortie: string | null;
  readonly clientNom: string;
  readonly telephone: string;
  readonly demandes: readonly string[];
  readonly voitMontants: boolean;
  readonly lignes: readonly LigneImprimeeOr[];
}

function construireLigneImprimee(
  ligne: ReponseLigneOr,
  voitMontants: boolean,
  l: LibellesOr,
): LigneImprimeeOr {
  return {
    designation: `${l.typeLigneOr[ligne.type]} — ${ligne.designation}`,
    quantite: String(ligne.quantiteMillieme / 1000),
    prixUnitaire:
      voitMontants && ligne.prixUnitaireCentimes != null
        ? formaterMontantCentimes(ligne.prixUnitaireCentimes)
        : null,
    montant:
      voitMontants && ligne.montants
        ? formaterMontantCentimes(ligne.montants.montantTtcCentimes)
        : null,
  };
}

export function construireDonneesImpressionOr(
  document: ReponseOrdreReparation,
  nomSite: string,
): DonneesImpressionOr {
  const langue = document.client.langueCorrespondance;
  const l = libellesImpressionOr(langue);
  // Voir la tête de fichier : signal fiable et indépendant de la valeur réelle du tableau.
  const voitMontants = document.totauxParPayeur !== undefined;

  return {
    libelles: l,
    numero: document.numero,
    site: nomSite,
    dateOuverture: formaterDateSuisse(document.ouvertLe ?? document.creeLe),
    type: l.typeOrdreReparation[document.type],
    statut: l.statutOrdreReparation[document.statut],
    restitutionPromise: document.restitutionPromiseLe
      ? formaterDateHeureSuisse(document.restitutionPromiseLe)
      : l.restitutionNonDefinie,
    vehiculeDesignation: document.vehicule.designation,
    immatriculation: document.vehicule.plaque ?? l.plaqueNonRenseignee,
    vin: document.vehicule.vin ?? l.vinNonRenseigne,
    kilometrageEntree:
      document.kilometrageEntree != null
        ? formaterKilometrage(document.kilometrageEntree)
        : l.kilometrageNonReleve,
    kilometrageSortie:
      document.kilometrageSortie != null ? formaterKilometrage(document.kilometrageSortie) : null,
    clientNom: document.client.nomAffiche,
    telephone: document.client.telephone ?? l.telephoneNonRenseigne,
    demandes: document.demandes.map((d) => d.verbatim),
    voitMontants,
    lignes: document.lignes.map((ligne) => construireLigneImprimee(ligne, voitMontants, l)),
  };
}
