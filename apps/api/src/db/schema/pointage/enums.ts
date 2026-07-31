/**
 * Énumérations Postgres PROPRES au lot 2 (pointage), créées par `migrations/0030_pointage.sql`.
 *
 * Ce qui N'EST PAS ici, volontairement — même doctrine que `contrats/pointage/enums.ts` côté
 * partagé : `statut_pointage`, `source_pointage`, `nature_activite_pointage` et
 * `statut_periode_pointage` existent DÉJÀ (`schema/atelier/enums.ts`, types créés par
 * `migrations/0005_parametrage.sql` — « déclaré au lot 1, servi au lot 2 »). Ce fichier ne les
 * redéclare pas : les tables de ce module les importent directement depuis `../atelier/enums`,
 * même pattern que `schema/pieces/reservation.ts` import `ligneOr`/`ordreReparation` depuis
 * `../atelier/ordre-reparation`.
 *
 * `statut_periode_pointage` reste un type RÉSERVÉ NON CONSOMMÉ par ce lot : voir l'en-tête de
 * `verrouillage-site.ts` pour la décision de modèle (un seuil par site, pas une collection de
 * périodes avec leur propre statut) et pourquoi cet enum pré-déclaré n'est délibérément pas
 * utilisé ici — un type déclaré non utilisé ne coûte rien (même doctrine que
 * `schema/atelier/enums.ts`, en-tête).
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import { ACTIVITES_INDIRECTES, MOTIFS_ANOMALIE_POINTAGE } from '@dfa/shared';

/**
 * `activite_indirecte_pointage` — extensible. RM-87 : catalogue des activités de la troisième
 * cible de pointage (`nature = 'indirect'`), aucun OR ni ligne associés. Miroir exact de
 * `ACTIVITES_INDIRECTES` (`contrats/pointage/enums.ts`), lui-même verbatim du namespace i18n
 * `pointage.activites.*` déjà complet FR/DE/IT.
 */
export const activiteIndirectePointageEnum = pgEnum('activite_indirecte_pointage', ACTIVITES_INDIRECTES);

/**
 * `motif_anomalie_pointage` — extensible. RM-91/RM-96/RM-123 : motif posé sur un pointage en
 * anomalie (corbeille de contrôle). Miroir exact de `MOTIFS_ANOMALIE_POINTAGE`
 * (`contrats/pointage/enums.ts`), y compris `derive_horloge` (seule valeur sans clé i18n
 * existante à ce jour — signalé par le contrat, pas comblé ici).
 */
export const motifAnomaliePointageEnum = pgEnum('motif_anomalie_pointage', MOTIFS_ANOMALIE_POINTAGE);
