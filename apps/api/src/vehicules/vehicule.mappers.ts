import type { GarantieVehicule, ImportationVehicule, ReponseVehicule, VehiculeResume } from '@dfa/shared';
import type { LigneVehicule } from '../db/schema';

/** Rendu d'affichage calculé par le serveur (`marque modele version`), jamais recomposé côté client. */
export function calculerDesignation(ligne: Pick<LigneVehicule, 'marque' | 'modele' | 'version'>): string {
  return [ligne.marque, ligne.modele, ligne.version].filter((partie) => Boolean(partie && partie.trim())).join(' ');
}

export function versImportation(
  ligne: Pick<LigneVehicule, 'importe' | 'paysOrigine' | 'dateImportation'>,
): ImportationVehicule {
  return { estImporte: ligne.importe, paysOrigine: ligne.paysOrigine, importeLe: ligne.dateImportation };
}

/** Ajoute `mois` mois à une date ISO (`aaaa-mm-jj`), en arithmétique calendaire UTC. */
export function ajouterMoisIso(dateIso: string, mois: number): string {
  const [annee, moisIndex, jour] = dateIso.split('-').map(Number);
  const date = new Date(Date.UTC(annee ?? 1970, (moisIndex ?? 1) - 1 + mois, jour ?? 1));
  return date.toISOString().slice(0, 10);
}

/**
 * RM-33 : la garantie est active si la date courante est dans la fenêtre (quand une durée est
 * connue) **et** si le kilométrage courant ne dépasse pas le plafond (quand plafond ET
 * kilométrage courant sont connus). En l'absence de durée ou de plafond, l'absence d'information
 * n'est pas traitée comme une expiration : le champ reste `active: true` tant qu'aucune limite
 * connue n'est dépassée — c'est au réceptionnaire de trancher (RM-33 : « sans décider à la place
 * du réceptionnaire »), le serveur ne fait qu'exposer les faits connus.
 *
 * AMBIGUÏTÉ DE CONTRAT SIGNALÉE : `ReponseVehicule`/`ReponseContexteAtelier` (packages/shared)
 * distinguent `garantieConstructeur` et `garantieGarage`, mais le schéma Drizzle/SQL de
 * `vehicule` (migrations/0007_vehicules.sql, L1-04/05) ne porte qu'UN SEUL jeu de colonnes
 * (`garantie_debut`, `garantie_mois`, `garantie_km`) — aucune colonne dédiée à une éventuelle
 * garantie vendue par le garage. Ce mapper expose donc ce jeu de colonnes comme
 * `garantieConstructeur` (cohérent avec RM-33 : « date de début = 1re mise en circulation ou date
 * de livraison » — une garantie d'origine, pas une extension commerciale) et renvoie
 * TOUJOURS `garantieGarage: null` au lot 1. À confirmer avec expert-database/expert-metier : soit
 * une migration ajoute un second jeu de colonnes, soit le contrat `@dfa/shared` est corrigé pour
 * n'exposer qu'une garantie.
 */
export function calculerGarantie(
  debutLe: string | null,
  mois: number | null,
  plafondKm: number | null,
  dernierKilometrageKm: number | null,
  maintenant: Date,
): GarantieVehicule | null {
  if (!debutLe) {
    return null;
  }

  const finLe = mois != null ? ajouterMoisIso(debutLe, mois) : null;
  const dateEncoreValide = finLe ? maintenant.toISOString().slice(0, 10) <= finLe : true;
  const kmEncoreValide = plafondKm != null && dernierKilometrageKm != null ? dernierKilometrageKm <= plafondKm : true;

  return { debutLe, finLe, plafondKm, active: dateEncoreValide && kmEncoreValide };
}

/** Projection publique complète — `ReponseVehicule`, `GET /vehicules/{id}` et enveloppes d'écriture. */
export function versReponseVehicule(
  ligne: LigneVehicule,
  plaqueCourante: { readonly valeur: string; readonly canton: string | null } | null,
  garantieConstructeur: GarantieVehicule | null,
): ReponseVehicule {
  return {
    id: ligne.id,
    vin: ligne.vin,
    marque: ligne.marque,
    modele: ligne.modele,
    version: ligne.version,
    finition: ligne.finition,
    codeTypeCh: ligne.codeTypeCh,
    premiereMiseEnCirculationLe: ligne.date1reCirculation,
    designation: calculerDesignation(ligne),
    plaque: plaqueCourante?.valeur ?? null,
    canton: plaqueCourante?.canton ?? null,
    carburant: ligne.carburant,
    cylindreeCm3: ligne.cylindreeCm3,
    puissanceKw: ligne.puissanceKw,
    boite: ligne.boite,
    transmission: ligne.transmission,
    normeEmission: ligne.normeEmission,
    couleur: ligne.couleur,
    codeCouleur: ligne.codeCouleur,
    poidsVideKg: ligne.poidsVideKg,
    poidsTotalKg: ligne.poidsTotalKg,
    places: ligne.places,
    pneusEte: ligne.pneusEte,
    pneusHiver: ligne.pneusHiver,
    pressionPneus: ligne.pressionPneus,
    huileType: ligne.huileType,
    huileQuantiteDl: ligne.huileQuantiteDl,
    batterie: ligne.batterie,
    codeRadio: ligne.codeRadio,
    codeCle: ligne.codeCle,
    intervalleEntretienKm: ligne.intervalleEntretienKm,
    intervalleEntretienMois: ligne.intervalleEntretienMois,
    importe: versImportation(ligne),
    garantieConstructeur,
    // Voir la note de contrat sur `calculerGarantie` : aucune colonne dédiée au lot 1.
    garantieGarage: null,
    proprietaireEconomiqueClientId: ligne.proprietaireEconomiqueClientId,
    conducteurHabituel: ligne.conducteurHabituel,
    identificationIncomplete: ligne.identificationIncomplete,
    statut: ligne.statut,
    motifArchivage: ligne.motifArchivage,
    fusionneVersVehiculeId: ligne.fusionneVersVehiculeId,
    creeLe: ligne.creeLe.toISOString(),
    modifieLe: ligne.modifieLe.toISOString(),
  };
}

export function versVehiculeResume(
  ligne: Pick<
    LigneVehicule,
    'id' | 'marque' | 'modele' | 'version' | 'vin' | 'date1reCirculation' | 'identificationIncomplete'
  >,
  plaqueCourante: { readonly valeur: string; readonly canton: string | null } | null,
): VehiculeResume {
  return {
    id: ligne.id,
    plaque: plaqueCourante?.valeur ?? null,
    canton: plaqueCourante?.canton ?? null,
    designation: calculerDesignation(ligne),
    vin: ligne.vin,
    premiereMiseEnCirculationLe: ligne.date1reCirculation,
    identificationIncomplete: ligne.identificationIncomplete,
  };
}
