/**
 * Fonctions pures de `RECHERCHE` (L1-11, §7.5 du contrat) — aucune n'ouvre de connexion, aucune
 * ne dépend de Drizzle : c'est ce qui les rend testables sans base et rapides à vérifier.
 *
 * La normalisation de recherche elle-même (casse, accents, séparateurs) N'EST PAS ici : elle vit
 * exclusivement dans `public.normaliser_recherche()` (migrations/0003_prealables_etape1.sql §2) et
 * n'est JAMAIS reproduite en TypeScript — deux normalisations divergentes produiraient des
 * résultats manquants indébogables (contrat §7.5). Ce fichier ne fait que composer ce que la base
 * a déjà normalisé.
 */

import type { EtatAfficheOrdreReparation, StatutOrdreReparation, TypeClient } from '@dfa/shared';

// -------------------------------------------------------------------------------------------
// Motif de fragment (CT-04)
// -------------------------------------------------------------------------------------------

/**
 * Construit le motif `%q%` AVANT normalisation SQL, à passer tel quel à
 * `public.normaliser_recherche(...)` côté requête : les `%` délimiteurs traversent la fonction
 * sans être altérés (absents de sa classe de caractères à supprimer, migrations/0003 §2), donc
 * `normaliser_recherche('%vd 123-456%')` produit bien `%vd123456%`. Même idiome que
 * `vehicules/service-vehicule.ts` (module voisin, L1-09) : `col like normaliser_recherche(motif)`
 * des deux côtés de la comparaison — c'est ce qui garde le membre gauche identique à l'expression
 * indexée (`vehicule_plaque_recherche_idx` et consorts) et permet au planificateur de l'utiliser.
 *
 * LIMITE CONNUE, partagée avec ce module voisin et non corrigée ici : un `%` ou `_` tapé
 * LITTÉRALEMENT par l'utilisateur (plaque/VIN/nom, en pratique jamais) serait interprété comme un
 * joker LIKE. Un échappement correct exigerait de s'insérer ENTRE la normalisation SQL et
 * l'enveloppe `%...%`, donc soit un aller-retour SQL supplémentaire, soit un `replace()` côté
 * requête — non fait, par cohérence avec le module voisin et parce que la donnée réelle (plaques,
 * VIN, noms suisses) ne contient jamais ces caractères.
 */
export function motifFragment(q: string): string {
  return `%${q}%`;
}

// -------------------------------------------------------------------------------------------
// Champ dérivé `etatAffiche` (contrats-api-etape-1.md §8.3)
// -------------------------------------------------------------------------------------------

/**
 * `etatAffiche` = le statut, OU le plus bloquant des trois drapeaux d'attente s'il y en a un
 * (priorité accord > pièces > externe), calculé une seule fois côté serveur. Dupliqué ici depuis
 * la définition du contrat (§8.3) parce que le module `atelier/` (L1-12) qui porte la ressource OR
 * complète est un périmètre exclusif d'un autre agent, indisponible pour cette recherche
 * transversale — voir la note de livraison pour le risque de divergence et sa mitigation (couvert
 * par des tests unitaires exhaustifs sur les 4 combinaisons de drapeaux).
 */
export function etatAfficheOrdreReparation(
  statut: StatutOrdreReparation,
  attenteAccord: boolean,
  attentePieces: boolean,
  attenteExterne: boolean,
): EtatAfficheOrdreReparation {
  if (attenteAccord) return 'attente_accord';
  if (attentePieces) return 'attente_pieces';
  if (attenteExterne) return 'attente_externe';
  return statut;
}

// -------------------------------------------------------------------------------------------
// Affichage
// -------------------------------------------------------------------------------------------

export interface IdentiteClient {
  readonly type: TypeClient;
  readonly nom: string | null;
  readonly prenom: string | null;
  readonly raisonSociale: string | null;
}

/**
 * Nom affiché d'un client, convention suisse "Nom Prénom" (RM-01 : `type` détermine quel champ est
 * la source — jamais l'inverse). DUPLICATION MINIMALE ET ASSUMÉE de la même règle canonique portée
 * par `vehicules/client-resume.helper.ts::calculerNomAfficheClient` (module voisin, L1-09,
 * développé en parallèle, hors périmètre `apps/api/src/recherche/**`) — l'importer depuis
 * `vehicules/` créerait une dépendance de compilation entre deux répertoires livrés par deux
 * agents différents. À terme cette règle devrait vivre une seule fois (`common/` ou
 * `@dfa/shared`) — signalé, pas résolu ici (même signalement que dans le module voisin).
 */
export function nomAfficheClient(client: IdentiteClient): string {
  if (client.type === 'entreprise') {
    return client.raisonSociale ?? '';
  }
  return [client.nom, client.prenom].filter((partie) => Boolean(partie && partie.trim())).join(' ');
}

export interface IdentiteVehicule {
  readonly marque: string;
  readonly modele: string;
  readonly version: string | null;
}

/**
 * Désignation affichée d'un véhicule : marque + modèle + version si connue. Même duplication
 * assumée que `nomAfficheClient` ci-dessus, vis-à-vis de `vehicules/vehicule.mappers.ts::calculerDesignation`.
 */
export function designationVehicule(vehicule: IdentiteVehicule): string {
  return [vehicule.marque, vehicule.modele, vehicule.version].filter((partie) => Boolean(partie && partie.trim())).join(' ');
}

/**
 * Année de 1re circulation depuis une colonne `date` lue en SQL brut. Défensif sur le type reçu :
 * le driver `pg` peut rendre une colonne `date` en `Date` ou en chaîne `'YYYY-MM-DD'` selon la
 * configuration de parseurs de types — aucune des deux n'est supposée ici, les deux sont acceptées.
 *
 * `getFullYear()` (LOCAL) et non `getUTCFullYear()` : le parseur par défaut de `pg` construit un
 * `Date` via `new Date(annee, mois, jour)` (minuit **local**, sans fuseau). En Suisse (UTC+1/+2),
 * relire cette valeur en UTC ferait retomber sur le 31 décembre de l'année précédente — piège
 * vérifié, pas supposé.
 */
export function anneeDepuisDate(valeur: string | Date | null): number | null {
  if (valeur === null) return null;
  if (valeur instanceof Date) return valeur.getFullYear();
  const correspondance = /^(\d{4})-/.exec(valeur);
  return correspondance ? Number(correspondance[1]) : null;
}
