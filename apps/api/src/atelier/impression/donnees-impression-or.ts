/**
 * Traduit `ReponseOrdreReparation` (contrat API, déjà filtré par rôle par `ServiceOr.
 * assemblerDocument`) en un DTO d'affichage PUR — aucune dépendance à `pdfkit` — pour deux
 * raisons :
 *  1. `generation-pdf-or.ts` reste un pur exercice de MISE EN PAGE, sans logique métier ;
 *  2. ce module est testable SANS parser le flux binaire d'un PDF (`generation-pdf-or.spec.ts`
 *     aurait dû décoder les chaînes hexadécimales `<...>Tj` de `pdfkit` pour vérifier qu'une
 *     donnée est bien absente — fragile et indirect ; `donnees-impression-or.spec.ts` vérifie la
 *     même règle directement sur les CHAÎNES avant tout rendu).
 *
 * Doctrine de contenu (issue #114) — cette feuille est accrochée au rétroviseur d'un véhicule
 * garé DEHORS, lisible par n'importe qui passant devant la vitre, pas remise en main propre :
 * c'est un support de TRAVAIL pour le mécanicien, pas un document commercial. Elle ne porte donc
 * JAMAIS le nom du client, son téléphone, un prix ou un total, ni de ligne de signature — quel
 * que soit le rôle qui imprime. C'est DIFFÉRENT du masquage des montants par rôle
 * (`ROLES_SANS_MONTANT`, `atelier/mappeurs.ts::roleVoitLesMontants`, encore actif ailleurs sur
 * `ReponseOrdreReparation` — `document.totauxParPayeur`/`lignes[].montants` restent filtrés en
 * amont, ce module n'y touche pas) : ici, les prix disparaissent pour TOUT LE MONDE, parce que
 * c'est le support physique qui l'exige, pas le droit de l'utilisateur qui imprime. Ce module ne
 * lit donc plus du tout `montants`/`prixUnitaireCentimes`/`totauxParPayeur`.
 */

import type { ReponseOrdreReparation, ReponseLigneOr } from '@dfa/shared';

import { formaterDateHeureSuisse, formaterDateSuisse, formaterKilometrage } from './formatage-or';
import { libellesImpressionOr, type LibellesOr } from './libelles-impression-or';

export interface LigneImprimeeOr {
  /** `<type traduit> — <désignation>`, ex. « Pièce — Plaquettes de frein avant ». Cochée à la
   *  main par le mécanicien à l'atelier (case dessinée par `generation-pdf-or.ts`) — jamais de
   *  prix ni de montant sur cette ligne, pour personne. */
  readonly designation: string;
  readonly quantite: string;
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
  readonly demandes: readonly string[];
  /** Noms des technicien·ne·s ayant pointé sur cet OR (`cumulsPointage.parTechnicien`), joints
   *  par une virgule. `null` — jamais une chaîne vide — quand aucun pointage n'est encore
   *  enregistré : la ligne « Technicien » est alors omise à l'impression, jamais un champ vide
   *  ambigu. Ce cumul reste TOUJOURS vide au lot 1 (module pointage, lot 2) — voir
   *  `ServiceOr.assemblerDocument` — cette feuille se peuplera automatiquement dès que
   *  `LecturePointage.cumulsPourOr` sera câblé, sans changement ici (champ additif). */
  readonly technicien: string | null;
  readonly lignes: readonly LigneImprimeeOr[];
}

function construireLigneImprimee(ligne: ReponseLigneOr, l: LibellesOr): LigneImprimeeOr {
  return {
    designation: `${l.typeLigneOr[ligne.type]} — ${ligne.designation}`,
    quantite: String(ligne.quantiteMillieme / 1000),
  };
}

export function construireDonneesImpressionOr(
  document: ReponseOrdreReparation,
  nomSite: string,
): DonneesImpressionOr {
  const langue = document.client.langueCorrespondance;
  const l = libellesImpressionOr(langue);
  const nomsTechniciens = document.cumulsPointage.parTechnicien.map((t) => t.nomAffiche);

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
    demandes: document.demandes.map((d) => d.verbatim),
    technicien: nomsTechniciens.length > 0 ? nomsTechniciens.join(', ') : null,
    lignes: document.lignes.map((ligne) => construireLigneImprimee(ligne, l)),
  };
}
